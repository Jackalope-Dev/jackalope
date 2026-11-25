import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  Disclosure,
  DisclosureSummary,
  FormField,
  IconButton,
  InlineNotice,
  Input,
  SegmentedControl,
  Select,
  SelectItem,
} from '@jackalope/ui';
import { Home, MousePointer2, RefreshCw, RotateCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { invokeNative } from '../../lib/native/transport';
import type { TaskRun } from '../../lib/run-types';
import {
  CONTENT_SIZES,
  describeElement,
  elementAt,
  framePosition,
  highlightBox,
  type SimulatorAction,
  type SimulatorElement,
  type SimulatorElements,
  type SimulatorFrame,
  type SimulatorPreviewState,
  type SimulatorTarget,
  simulatorStatus,
} from '../../lib/simulator-preview';
import { stopPreview } from '../../lib/task-client';
import { useProjectStore } from '../../stores/projectStore';
import { ActionError } from '../ui/ActionError';
import { type Capture, SelectionNotes, useSelectionNotes } from './DesignPreview';
import './simulator-preview.css';

interface SimulatorPreviewView {
  command: string;
  kind: 'simulator';
  running: boolean;
  ready: boolean;
  output: string;
  simulator?: SimulatorPreviewState;
}

const STATUS_MS = 2000;
/** Frames refresh at about one and a half per second while the screen is visible. */
const FRAME_MS = 650;

/**
 * The iOS kind of Preview: builds the task's app for its own Simulator, shows the
 * screen live and lets the person tap, type, change device settings, open links and
 * select elements for feedback. Frames are read on demand and never saved.
 */
export function SimulatorPreview({
  run,
  target,
  onFeedback,
}: {
  run: TaskRun;
  target: SimulatorTarget;
  onFeedback?: (text: string) => void | Promise<void>;
}) {
  const project = useProjectStore((state) =>
    state.projects.find((project) => project.id === run.projectId),
  );
  const [preview, setPreview] = useState<SimulatorPreviewView | null>(null);
  const [command, setCommand] = useState(project?.preferences?.simulatorPreview ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [frame, setFrame] = useState<SimulatorFrame | null>(null);
  const [frameError, setFrameError] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [elements, setElements] = useState<SimulatorElements | null>(null);
  const [hovered, setHovered] = useState<SimulatorElement | null>(null);
  const [link, setLink] = useState('');
  const [text, setText] = useState('');
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const notes = useSelectionNotes(run.id);
  const statusRevision = useRef(0);
  const mutating = useRef(false);
  const image = useRef<HTMLImageElement>(null);
  const state = preview?.simulator;
  const live = state?.phase === 'running';

  useEffect(() => {
    let alive = true;
    let loading = false;
    const load = async () => {
      if (loading || mutating.current) return;
      loading = true;
      const revision = statusRevision.current;
      try {
        const value = await invokeNative<SimulatorPreviewView | null>('task_preview_status', {
          id: run.id,
        });
        if (alive && revision === statusRevision.current)
          setPreview(value?.kind === 'simulator' ? value : null);
      } catch (cause) {
        if (alive) setError(describeError(cause));
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), STATUS_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [run.id]);

  useEffect(() => {
    if (!live) {
      setFrame(null);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = async () => {
      if (!alive) return;
      if (document.visibilityState !== 'hidden') {
        try {
          const value = await invokeNative<SimulatorFrame>('task_preview_simulator_frame', {
            id: run.id,
          });
          if (alive) {
            setFrame(value);
            setFrameError('');
          }
        } catch (cause) {
          if (alive) setFrameError(describeError(cause));
        }
      }
      if (alive) timer = setTimeout(() => void next(), FRAME_MS);
    };
    void next();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [live, run.id]);

  const loadElements = async () => {
    try {
      setElements(
        await invokeNative<SimulatorElements>('task_preview_simulator_elements', { id: run.id }),
      );
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  useEffect(() => {
    if (!selecting) {
      setHovered(null);
      return;
    }
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelecting(false);
    };
    window.addEventListener('keydown', exit);
    return () => window.removeEventListener('keydown', exit);
  }, [selecting]);

  const act = async (fn: () => Promise<void>) => {
    statusRevision.current++;
    mutating.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  };

  const send = async (action: SimulatorAction) => {
    setError('');
    try {
      await invokeNative('task_preview_simulator_act', { id: run.id, action });
      if (selecting) void loadElements();
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const position = (event: React.MouseEvent) => {
    const rect = image.current?.getBoundingClientRect();
    return rect ? framePosition(event.clientX, event.clientY, rect) : null;
  };

  const choose = async (point: { x: number; y: number }) => {
    setSelectionBusy(true);
    setError('');
    try {
      const capture = await invokeNative<Capture>('task_preview_simulator_select', {
        id: run.id,
        x: point.x,
        y: point.y,
      });
      if (notes.add(capture))
        setNotice(`Selected ${capture.selection.tag}. Describe the change below.`);
      void loadElements();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSelectionBusy(false);
    }
  };

  const status = preview
    ? preview.simulator?.phase === 'failed'
      ? preview.simulator.error?.split('\n')[0] || simulatorStatus(preview.simulator)
      : simulatorStatus(preview.simulator)
    : 'Build this task’s app and run it in its own iOS Simulator.';
  const running = !!preview?.running;
  const highlight = selecting && hovered && elements?.screen ? hovered : null;

  return (
    <section className="task-preview space-y-3" aria-label="Try result">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base">Preview</h2>
          <p className="task-muted" role="status">
            {status}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {preview ? (
            <>
              {running && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await invokeNative('task_preview_simulator_reload', { id: run.id });
                      setNotice('Rebuilding with the workspace’s current files.');
                    })
                  }
                >
                  <RefreshCw size={16} aria-hidden="true" /> Rebuild
                </Button>
              )}
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    setSelecting(false);
                    await stopPreview(run.id);
                    setPreview(null);
                  })
                }
              >
                {running ? 'Stop preview' : 'Save log and reset'}
              </Button>
            </>
          ) : (
            <Button
              disabled={busy || (!!target.issue && !command.trim())}
              loading={busy}
              loadingLabel="Starting…"
              onClick={() =>
                void act(async () => {
                  setPreview(
                    await invokeNative<SimulatorPreviewView>('task_preview_simulator_start', {
                      id: run.id,
                      command: command.trim() || null,
                    }),
                  );
                  if (project)
                    useProjectStore.getState().updateProjectPreferences(project.id, {
                      simulatorPreview: command.trim() || undefined,
                    });
                })
              }
            >
              Run in Simulator
            </Button>
          )}
        </div>
      </div>
      {target.issue && !preview && <InlineNotice>{target.issue}</InlineNotice>}
      {!preview && (
        <Disclosure>
          <DisclosureSummary>
            Build setup · {command.trim() || target.buildCommand}
          </DisclosureSummary>
          <div className="space-y-3">
            <FormField
              label="Build command"
              description={
                <>
                  Leave empty to build {target.scheme ? `the ${target.scheme} scheme` : 'the app'}{' '}
                  for the task’s Simulator. A saved command runs in the workspace with your OS
                  permissions, is remembered for this project and must build with -derivedDataPath
                  "$JACKALOPE_DERIVED_DATA".
                </>
              }
            >
              <Input
                id="simulator-preview-command"
                maxLength={4000}
                value={command}
                disabled={busy}
                spellCheck={false}
                onChange={(event) => setCommand(event.target.value)}
                placeholder={target.buildCommand}
              />
            </FormField>
          </div>
        </Disclosure>
      )}
      {state?.input === 'failed' && (
        <InlineNotice tone="error">
          Taps and typing are unavailable: {state.inputError ?? 'the input driver did not start.'}
        </InlineNotice>
      )}
      {live && (
        <div className="simulator-preview">
          <div className="simulator-preview-toolbar" role="toolbar" aria-label="Simulator controls">
            <IconButton
              label="Home"
              variant="outline"
              disabled={!!state && state.input === 'failed'}
              onClick={() => void send({ action: 'home' })}
            >
              <Home size={16} aria-hidden="true" />
            </IconButton>
            <IconButton
              label={state?.landscape ? 'Rotate to portrait' : 'Rotate to landscape'}
              variant="outline"
              disabled={!!state && state.input === 'failed'}
              onClick={() => void send({ action: 'rotate' })}
            >
              <RotateCw size={16} aria-hidden="true" />
            </IconButton>
            <SegmentedControl<'light' | 'dark'>
              label="Appearance"
              items={[
                { id: 'light', label: 'Light' },
                { id: 'dark', label: 'Dark' },
              ]}
              value={state?.appearance === 'dark' ? 'dark' : 'light'}
              onChange={(value) => void send({ action: 'appearance', value })}
            />
            <Select
              aria-label="Text size"
              value={state?.contentSize ?? 'large'}
              onValueChange={(value) => void send({ action: 'contentSize', value })}
            >
              {CONTENT_SIZES.map((size) => (
                <SelectItem key={size.id} value={size.id}>
                  {size.label}
                </SelectItem>
              ))}
            </Select>
            <Button
              variant="outline"
              aria-pressed={selecting}
              disabled={!!notes.loadError || state?.input === 'failed'}
              onClick={() => {
                const next = !selecting;
                setSelecting(next);
                setNotice(next ? 'Choose an element on the screen. Escape leaves Select.' : '');
                if (next) void loadElements();
              }}
            >
              <MousePointer2 size={16} aria-hidden="true" />{' '}
              {selecting ? 'Done selecting' : 'Select'}
            </Button>
          </div>
          <div className="simulator-preview-stage">
            {frame ? (
              // biome-ignore lint/a11y/noStaticElementInteractions: pointer taps on the device screen; every action is also on the toolbar or a field.
              // biome-ignore lint/a11y/useKeyWithClickEvents: as above.
              <div
                className="simulator-preview-screen"
                data-selecting={selecting || undefined}
                data-busy={selectionBusy || undefined}
                onMouseMove={(event) => {
                  if (!selecting || !elements) return;
                  const point = position(event);
                  setHovered(point ? elementAt(elements, point) : null);
                }}
                onMouseLeave={() => setHovered(null)}
                onClick={(event) => {
                  const point = position(event);
                  if (!point) return;
                  if (selecting) {
                    if (!selectionBusy) void choose(point);
                  } else void send({ action: 'tap', ...point });
                }}
              >
                <img
                  ref={image}
                  src={`data:image/png;base64,${frame.png}`}
                  width={frame.width}
                  height={frame.height}
                  alt={`Screen of ${state?.device ?? 'the Simulator'}${selecting ? '. Choose an element to select it.' : '. Click to tap.'}`}
                  draggable={false}
                />
                {highlight && elements?.screen && (
                  <span
                    className="simulator-preview-highlight"
                    style={highlightBox(highlight, elements.screen)}
                    aria-hidden="true"
                  />
                )}
              </div>
            ) : (
              <p className="simulator-preview-empty task-muted" role="status">
                {frameError || 'Loading the screen…'}
              </p>
            )}
            {selecting && (
              <p className="task-muted" aria-live="polite">
                {hovered
                  ? describeElement(hovered)
                  : 'Point at an element to see what Select saves.'}
              </p>
            )}
          </div>
          <div className="simulator-preview-forms">
            <form
              className="simulator-preview-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!text) return;
                void send({ action: 'type', text }).then(() => setText(''));
              }}
            >
              <FormField className="min-w-0 flex-1" label="Type into the focused field">
                <Input
                  id="simulator-preview-text"
                  value={text}
                  maxLength={5000}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setText(event.target.value)}
                />
              </FormField>
              <Button type="submit" variant="outline" disabled={!text}>
                Send text
              </Button>
            </form>
            <form
              className="simulator-preview-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!link.trim()) return;
                void send({ action: 'openUrl', url: link.trim() });
              }}
            >
              <FormField className="min-w-0 flex-1" label="Open link">
                <Input
                  id="simulator-preview-link"
                  value={link}
                  maxLength={4096}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="myapp://settings"
                  onChange={(event) => setLink(event.target.value)}
                />
              </FormField>
              <Button type="submit" variant="outline" disabled={!link.trim()}>
                Open
              </Button>
            </form>
          </div>
        </div>
      )}
      <SelectionNotes
        runId={run.id}
        notes={notes}
        busy={busy || selectionBusy}
        setBusy={setBusy}
        onFeedback={onFeedback}
      />
      {preview && (
        <Disclosure open={state?.phase === 'failed' || undefined}>
          <DisclosureSummary>Build log</DisclosureSummary>
          <pre className="task-input whitespace-pre-wrap break-words max-h-64 overflow-auto">
            {preview.output || 'No output yet.'}
          </pre>
        </Disclosure>
      )}
      {notice && (
        <p role="status" className="task-muted">
          {notice}
        </p>
      )}
      <ActionError error={error} />
      {running && (
        <p className="task-muted">
          Stop preview before continuing or merging. It keeps running when you leave this view.
        </p>
      )}
    </section>
  );
}
