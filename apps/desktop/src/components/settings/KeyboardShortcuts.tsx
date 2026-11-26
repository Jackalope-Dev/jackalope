import {
  Button,
  CopyButton,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FieldCheck,
  IconButton,
  InlineNotice,
  SearchField,
  SettingActions,
  SettingBody,
  SettingGroup,
  SettingRow,
  Textarea,
  Tooltip,
} from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { RotateCcw, X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useResolvedKeybindings } from '../../hooks/useKeybindings';
import {
  bindingKeycaps,
  bindingProblem,
  CONTEXT_LABELS,
  conflictsFor,
  defaultBinding,
  displayBinding,
  exportKeybindings,
  importKeybindings,
  KEYBINDING_ACTIONS,
  KEYBINDING_GROUPS,
  type KeybindingAction,
  type KeybindingId,
  keybindingAction,
  keybindingOverrides,
  recordStroke,
} from '../../lib/keybindings';
import { useSettingsStore } from '../../stores/settingsStore';

/** How long the recorder waits for a chord's second key before keeping the first alone. */
const CHORD_WAIT_MS = 1000;

function Keycaps({ binding }: { binding: string }) {
  const strokes = bindingKeycaps(binding);
  if (!strokes.length) return <span className="shortcut-unset">Not set</span>;
  return (
    <span className="shortcut-keys" role="img" aria-label={displayBinding(binding)}>
      {strokes.map((keys, stroke) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a chord's strokes have no other identity
        <span key={stroke} className="shortcut-stroke">
          {stroke > 0 && <span className="shortcut-then">then</span>}
          {keys.map((key) => (
            <kbd key={key} className="shortcut-key">
              {key}
            </kbd>
          ))}
        </span>
      ))}
    </span>
  );
}

/** A clash waiting for the person to swap, replace or keep their bindings. */
interface Clash {
  id: KeybindingId;
  binding: string;
  others: KeybindingId[];
}

export function KeyboardShortcuts() {
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const bindings = useResolvedKeybindings();
  const [query, setQuery] = useState('');
  const [recording, setRecording] = useState<{ id: KeybindingId; strokes: string[] } | null>(null);
  const [clash, setClash] = useState<Clash | null>(null);
  const [problem, setProblem] = useState<{ id: KeybindingId; message: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const recordButtons = useRef(new Map<KeybindingId, HTMLButtonElement>());
  /** The recording in progress, read by timers and blur after the state has moved on. */
  const active = useRef<{ id: KeybindingId; strokes: string[] } | null>(null);
  const latest = useRef(bindings);
  latest.current = bindings;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const focusRow = (id: KeybindingId) =>
    requestAnimationFrame(() => recordButtons.current.get(id)?.focus());
  const save = (next: Record<KeybindingId, string>) =>
    updateSettings({ shortcuts: keybindingOverrides(next) });

  const assign = (id: KeybindingId, binding: string) => {
    const bindings = latest.current;
    setProblem(null);
    setClash(null);
    setNotice('');
    const reason = binding && bindingProblem(binding);
    if (reason) return setProblem({ id, message: reason });
    const others = binding ? conflictsFor(bindings, id, binding) : [];
    if (others.length) return setClash({ id, binding, others });
    save({ ...bindings, [id]: binding });
  };

  /** Gives the clashing action this one's old binding when that is free, else clears it. */
  const swapTarget = (pending: Clash) => {
    const previous = bindings[pending.id];
    if (!previous || pending.others.length !== 1) return null;
    const next = { ...bindings, [pending.id]: pending.binding };
    return conflictsFor(next, pending.others[0], previous).length === 0 ? previous : null;
  };
  const resolveClash = (pending: Clash) => {
    const next = { ...latest.current, [pending.id]: pending.binding };
    const swapped = swapTarget(pending);
    for (const other of pending.others) next[other] = '';
    if (swapped) next[pending.others[0]] = swapped;
    save(next);
    setClash(null);
    focusRow(pending.id);
  };

  const startRecording = (id: KeybindingId) => {
    setProblem(null);
    setClash(null);
    active.current = { id, strokes: [] };
    setRecording(active.current);
  };
  /** Ends the recording, keeping what was pressed unless `keep` is false. */
  const stopRecording = (keep: boolean) => {
    const current = active.current;
    clearTimeout(timer.current);
    active.current = null;
    setRecording(null);
    if (!current) return;
    if (keep && current.strokes.length) assign(current.id, current.strokes.join(' '));
    focusRow(current.id);
  };
  const onRecorderKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const current = active.current;
    if (!current) return;
    const bare = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    // Tab leaves the recorder as it leaves any control.
    if (event.key === 'Tab' && bare) return;
    // The keys belong to the recorder, not to the shortcuts or dialogs around it.
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') return stopRecording(false);
    if (event.key === 'Enter' && bare && current.strokes.length) return stopRecording(true);
    if (event.repeat) return;
    const stroke = recordStroke(event.nativeEvent);
    if (!stroke) return;
    active.current = { id: current.id, strokes: [...current.strokes, stroke] };
    clearTimeout(timer.current);
    if (active.current.strokes.length === 2) return stopRecording(true);
    setRecording(active.current);
    timer.current = setTimeout(() => stopRecording(true), CHORD_WAIT_MS);
  };

  const overrides = keybindingOverrides(bindings);
  const customized = Object.keys(overrides).length > 0;
  const search = query.trim().toLowerCase();
  const matches = (action: KeybindingAction) =>
    !search ||
    [
      action.label,
      action.group,
      CONTEXT_LABELS[action.when],
      action.id,
      bindings[action.id] ? displayBinding(bindings[action.id]) : 'not set',
    ]
      .join(' ')
      .toLowerCase()
      .includes(search);
  const groups = KEYBINDING_GROUPS.map((group) => ({
    group,
    actions: KEYBINDING_ACTIONS.filter((action) => action.group === group && matches(action)),
  })).filter((entry) => entry.actions.length);

  return (
    <>
      <SettingGroup
        aria-label="Find and share shortcuts"
        description="Choose Record, then press the keys. Press a second key within a second to make a chord, or Enter to keep one key. Escape cancels."
      >
        <SettingBody>
          <SearchField
            value={query}
            onValueChange={setQuery}
            placeholder="Search shortcuts"
            aria-label="Search shortcuts"
          />
        </SettingBody>
        <SettingActions>
          <Button variant="outline" onClick={() => setImporting(true)}>
            Import…
          </Button>
          <CopyButton
            variant="outline"
            text={exportKeybindings(bindings)}
            label="Copy as JSON"
            onCopied={() => setNotice('')}
          />
          <Button
            variant="ghost"
            disabled={!customized}
            onClick={() => {
              updateSettings({ shortcuts: {} });
              setClash(null);
              setProblem(null);
              setNotice('Every shortcut is back to its default.');
            }}
          >
            Reset all
          </Button>
        </SettingActions>
        {notice && (
          <SettingBody>
            <InlineNotice tone="success">{notice}</InlineNotice>
          </SettingBody>
        )}
      </SettingGroup>
      {groups.length === 0 && (
        <SettingGroup>
          <EmptyState title="No shortcuts match" description="Try an action or a key name." />
        </SettingGroup>
      )}
      {groups.map(({ group, actions }) => (
        <SettingGroup key={group} title={group} aria-label={`${group} shortcuts`}>
          {actions.map((action) => {
            const { id, label } = action;
            const binding = bindings[id];
            const fallback = defaultBinding(action);
            const isDefault = !(id in overrides);
            const where = CONTEXT_LABELS[action.when];
            const rowClash = clash?.id === id ? clash : null;
            const swapped = rowClash && swapTarget(rowClash);
            return (
              <div key={id} className="shortcut-row" data-action={id}>
                <SettingRow
                  title={label}
                  description={
                    problem?.id === id ? (
                      <FieldCheck tone="error">{problem.message}</FieldCheck>
                    ) : (
                      where || undefined
                    )
                  }
                >
                  <span className="shortcut-edit">
                    {recording?.id === id ? (
                      <button
                        type="button"
                        className="shortcut-recorder"
                        // biome-ignore lint/a11y/noAutofocus: recording starts from the Record button the person just pressed.
                        autoFocus
                        aria-label={`Press the new shortcut for ${label}. Escape cancels.`}
                        onBlur={() => stopRecording(true)}
                        onKeyDown={onRecorderKey}
                      >
                        {recording.strokes.length ? (
                          <>
                            <Keycaps binding={recording.strokes.join(' ')} />
                            <span aria-hidden="true">…</span>
                          </>
                        ) : (
                          'Press keys…'
                        )}
                      </button>
                    ) : (
                      <Keycaps binding={binding} />
                    )}
                    <Button
                      ref={(element) => {
                        if (element) recordButtons.current.set(id, element);
                        else recordButtons.current.delete(id);
                      }}
                      variant="ghost"
                      size="sm"
                      aria-label={`Record a shortcut for ${label} (now ${displayBinding(binding)})`}
                      onClick={() => startRecording(id)}
                    >
                      Record
                    </Button>
                    <Tooltip content="Clear">
                      <IconButton
                        label={`Clear the shortcut for ${label}`}
                        disabled={!binding}
                        onClick={() => {
                          assign(id, '');
                          focusRow(id);
                        }}
                      >
                        <X size={16} aria-hidden="true" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip content={`Reset to ${displayBinding(fallback)}`}>
                      <IconButton
                        label={`Reset ${label} to ${displayBinding(fallback)}`}
                        disabled={isDefault}
                        onClick={() => {
                          assign(id, fallback);
                          focusRow(id);
                        }}
                      >
                        <RotateCcw size={16} aria-hidden="true" />
                      </IconButton>
                    </Tooltip>
                  </span>
                </SettingRow>
                {rowClash && (
                  <SettingBody>
                    <InlineNotice
                      tone="warning"
                      role="alert"
                      action={
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => resolveClash(rowClash)}
                          >
                            {swapped ? 'Swap' : 'Replace'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setClash(null);
                              focusRow(id);
                            }}
                          >
                            Cancel
                          </Button>
                        </>
                      }
                    >
                      {displayBinding(rowClash.binding)} is already used by{' '}
                      {rowClash.others
                        .map((other) => keybindingAction(other)?.label ?? other)
                        .join(' and ')}
                      .{' '}
                      {swapped
                        ? `Swap gives it ${displayBinding(swapped)}.`
                        : 'Replace leaves it without a shortcut.'}
                    </InlineNotice>
                  </SettingBody>
                )}
              </div>
            );
          })}
        </SettingGroup>
      ))}
      <ImportDialog
        open={importing}
        onOpenChange={setImporting}
        onImport={(next, ignored) => {
          updateSettings({ shortcuts: next });
          setClash(null);
          setProblem(null);
          setNotice(
            ignored.length
              ? `Imported. Skipped actions this version doesn’t have: ${ignored.join(', ')}.`
              : 'Imported.',
          );
        }}
      />
    </>
  );
}

function ImportDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (overrides: Record<string, string>, ignored: string[]) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const load = async (chosen: File | undefined) => {
    if (!chosen) return;
    try {
      setText(await chosen.text());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const submit = () => {
    const result = importKeybindings(text);
    if ('error' in result) return setError(result.error);
    onImport(result.overrides, result.ignored);
    setText('');
    setError('');
    onOpenChange(false);
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setError('');
        onOpenChange(next);
      }}
    >
      <DialogContent className="shortcut-import">
        <DialogCloseButton label="Close import" />
        <DialogHeader
          title="Import shortcuts"
          description="Paste shortcuts copied from Jackalope, or choose a JSON file. They replace your current changes."
        />
        <div className="shortcut-import-body">
          <Textarea
            aria-label="Shortcuts JSON"
            className="font-mono text-xs"
            rows={8}
            spellCheck={false}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError('');
            }}
            placeholder={'{ "bindings": { "search": "Mod+P" } }'}
          />
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="Choose a shortcuts file"
            onChange={(event) => {
              void load(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => file.current?.click()}>
            Choose file…
          </Button>
          <Button onClick={submit} disabled={!text.trim()}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}
