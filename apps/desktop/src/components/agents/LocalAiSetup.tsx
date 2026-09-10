import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Cpu,
  Download,
  ExternalLink,
  HardDrive,
  Loader2,
  MemoryStick,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  downloadPercent,
  formatMemory,
  formatSize,
  type LocalInspection,
  type LocalModel,
  type LocalProgress,
  type LocalVerification,
  modelFit,
} from '../../lib/local-ai';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useAgentAccountsStore } from '../../stores/agentAccountsStore';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import { Button } from '../ui/button';
import './local-ai.css';

const stages = ['Your computer', 'Choose a model', 'Install & download', 'Check & connect'];
type SetupActivity = 'inspect' | 'ollama' | 'opencode' | 'model' | 'verify' | 'connect';

export function LocalAiSetup({
  onConnected,
  compact = false,
  preview,
  projectSetup = false,
}: {
  onConnected?: (profileId: string) => void | Promise<void>;
  compact?: boolean;
  preview?: LocalInspection;
  projectSetup?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={`local-ai-entry ${compact ? 'local-ai-entry-compact' : ''}`}
        >
          <span className="local-ai-symbol">
            <Cpu size={23} />
          </span>
          <span>
            <strong>Try a local agent</strong>
            <small>
              No AI subscription needed. Check your computer and choose what to download.
            </small>
          </span>
          <ArrowRight size={19} aria-hidden="true" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="local-ai-overlay" />
        <Dialog.Content className="local-ai-dialog" aria-describedby="local-ai-description">
          <header className="local-ai-header">
            <span className="local-ai-symbol">
              <Cpu size={25} />
            </span>
            <div>
              <Dialog.Title>Set up a local agent</Dialog.Title>
              <Dialog.Description id="local-ai-description">
                Your computer runs the model. Jackalope guides the setup.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close local setup">
                <X size={20} />
              </Button>
            </Dialog.Close>
          </header>
          {open && (
            <LocalAiSteps
              preview={preview}
              projectSetup={projectSetup}
              onConnected={onConnected}
              onClose={() => setOpen(false)}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function LocalAiSteps({
  onConnected,
  onClose,
  preview,
  projectSetup = false,
}: {
  onConnected?: (profileId: string) => void | Promise<void>;
  onClose: () => void;
  preview?: LocalInspection;
  projectSetup?: boolean;
}) {
  const [inspection, setInspection] = useState<LocalInspection | null>(preview ?? null);
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState('qwen3.5:4b');
  const [busy, setBusy] = useState('');
  const [activity, setActivity] = useState<SetupActivity>('inspect');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<LocalProgress | null>(null);
  const [verification, setVerification] = useState<LocalVerification | null>(null);
  const [connected, setConnected] = useState(false);
  const [stopping, setStopping] = useState(false);
  const active = useRef(true);
  const working = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const desktop = isTauriEnvironment() && !preview;
  const model = inspection?.models.find((m) => m.id === selected);
  const installed = inspection?.installedModels.includes(selected);
  const inspect = useCallback(async () => {
    const found = await nativeTask<LocalInspection>('local_ai_inspect');
    if (active.current) setInspection(found);
    return found;
  }, []);
  const perform = useCallback(
    async (target: SetupActivity, label: string, action: () => Promise<void>) => {
      if (working.current) return;
      working.current = true;
      setActivity(target);
      setElapsed(0);
      setBusy(label);
      setError('');
      setProgress(null);
      setStopping(false);
      try {
        await action();
      } catch (cause) {
        if (active.current) setError(String(cause));
      } finally {
        working.current = false;
        if (active.current) {
          setBusy('');
          setStopping(false);
        }
      }
    },
    [],
  );
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    active.current = true;
    if (desktop)
      void perform('inspect', 'Checking your computer…', async () => {
        await inspect();
      });
    return () => {
      active.current = false;
      if (working.current && desktop) void nativeTask('local_ai_cancel').catch(() => {});
    };
  }, [desktop, inspect, perform]);
  useEffect(() => {
    if (heading.current?.dataset.step === String(step)) heading.current.focus();
  }, [step]);
  const withProgress = async <T,>(command: string, args: Record<string, unknown> = {}) => {
    const { Channel } = await import('@tauri-apps/api/core');
    if (!active.current) throw new Error('Setup closed. Reopen it to continue.');
    const channel = new Channel<LocalProgress>();
    channel.onmessage = (event) => {
      if (active.current) setProgress(event);
    };
    return nativeTask<T>(command, { modelId: selected, ...args, progress: channel });
  };
  const openLink = async (url: string, target: SetupActivity) => {
    setActivity(target);
    try {
      if (desktop) {
        const { open } = await import('@tauri-apps/plugin-shell');
        await open(url);
      } else window.open(url, '_blank', 'noopener,noreferrer');
    } catch (cause) {
      setError(String(cause));
    }
  };
  const install = (tool: 'ollama' | 'opencode') =>
    void perform(
      tool,
      `Preparing ${tool === 'ollama' ? 'Ollama' : 'OpenCode'} installation…`,
      async () => {
        await withProgress('local_ai_install', { tool });
        await inspect();
      },
    );
  const connect = () =>
    void perform('connect', 'Connecting your local agent…', async () => {
      const profile = await nativeTask<{ id: string }>('local_ai_connect', { modelId: selected });
      const config = useAgentConfigStore.getState();
      const options = config.runnerOptions.opencode ?? {
        models: [],
        restrictModels: false,
        defaultModel: '',
      };
      const id = `jackalope-local/${selected}`;
      config.toggleAgent('opencode', true);
      config.setRunnerOptions('opencode', {
        ...options,
        models: [...new Set([...options.models, id])],
      });
      await syncAgentConfig();
      await useExecutionStore.getState().discover();
      if (
        !useExecutionStore
          .getState()
          .runners.some((runner) => runner.id === config.defaultMetaAgent && runner.available)
      ) {
        config.setDefaultMetaAgent('opencode');
      }
      await syncAgentConfig();
      await useAgentAccountsStore.getState().load('opencode', true);
      if (active.current) {
        await onConnected?.(profile.id);
        if (active.current) setConnected(true);
      }
    });
  const status = (target: SetupActivity) =>
    activity === target && (busy || error) ? (
      <SetupStatus
        label={busy}
        progress={progress}
        elapsed={elapsed}
        stopping={stopping}
        error={error}
        onStop={
          target === 'inspect' || target === 'connect'
            ? undefined
            : async () => {
                setStopping(true);
                try {
                  await nativeTask('local_ai_cancel');
                } catch (cause) {
                  setError(String(cause));
                  setStopping(false);
                }
              }
        }
      />
    ) : null;
  return (
    <>
      <ol className="local-ai-steps" aria-label="Setup progress">
        {stages.map((stage, index) => (
          <li
            key={stage}
            aria-current={index === step ? 'step' : undefined}
            data-complete={index < step || connected}
          >
            <span>{index < step || connected ? <Check size={14} /> : index + 1}</span>
            <small>{stage}</small>
          </li>
        ))}
      </ol>
      <div className="local-ai-body">
        {preview && (
          <p className="local-ai-caption">Preview only · no native setup or downloads.</p>
        )}
        {!desktop && !preview && (
          <p className="local-ai-notice">
            <Monitor size={18} />
            Open the desktop app to inspect your computer and install a local agent.
          </p>
        )}
        <h3 tabIndex={-1} ref={heading} data-step={step}>
          {connected ? 'Your local agent is connected' : stages[step]}
        </h3>
        {step === 0 && (
          <>
            <p>
              A local agent can explain code and make focused changes without an AI subscription.
              Speed and quality depend on your computer and the model.
            </p>
            <div className="local-ai-hardware">
              <Hardware
                icon={<MemoryStick size={20} />}
                label="System memory"
                value={formatMemory(inspection?.hardware.memoryBytes ?? null)}
                detail={
                  inspection?.hardware.availableMemoryBytes
                    ? `${formatMemory(inspection.hardware.availableMemoryBytes)} available now`
                    : 'Available memory varies as apps run'
                }
              />
              <Hardware
                icon={<HardDrive size={20} />}
                label="Free disk space"
                value={formatSize(inspection?.hardware.freeDiskBytes ?? null)}
                detail="On the expected model drive"
              />
              <Hardware
                icon={<Cpu size={20} />}
                label="Graphics"
                value={inspection?.hardware.gpu || 'Not detected'}
                detail="A GPU can help; acceleration is checked by Ollama"
              />
            </div>
            <p className="local-ai-notice">
              <ShieldCheck size={19} />
              Model requests stay on this computer. Agent tools may still access the internet.
              Jackalope account access is separate.
            </p>
            <Button
              variant="ghost"
              disabled={!desktop || !!busy}
              onClick={() =>
                void perform('inspect', 'Checking your computer…', async () => {
                  await inspect();
                })
              }
            >
              <RefreshCw size={16} />
              Check again
            </Button>
            {status('inspect')}
          </>
        )}
        {step === 1 && inspection && (
          <>
            <p>
              Choose an optional download. No model is bundled with Jackalope, and nothing downloads
              until you start it.
            </p>
            <fieldset className="local-ai-models">
              <legend className="sr-only">Local coding model</legend>
              {inspection.models.map((item) => (
                <ModelChoice
                  key={item.id}
                  model={item}
                  inspection={inspection}
                  selected={selected === item.id}
                  onSelect={() => {
                    setSelected(item.id);
                    setVerification(null);
                  }}
                />
              ))}
            </fieldset>
            <p className="local-ai-caption">
              Download sizes are estimates checked {inspection.catalogCheckedAt}. Working memory
              also includes the 64K coding context and other apps. Memory guidance is conservative,
              not a speed guarantee.
            </p>
          </>
        )}
        {step === 2 && inspection && model && (
          <>
            <p>
              Install the two tools, then download <strong>{model.name}</strong>. Existing
              installations and downloaded models are reused.
            </p>
            <div className="local-ai-install-list">
              <InstallRow
                title="Ollama"
                detail="Runs the model · allow at least 4 GB of additional disk space"
                done={inspection.ollamaOnline}
                activity={status('ollama')}
                pending={activity === 'ollama' && !!busy}
              >
                {inspection.canInstall && (
                  <Button
                    variant="outline"
                    disabled={!desktop || !!busy}
                    onClick={() => install('ollama')}
                  >
                    Install Ollama
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => void openLink('https://ollama.com/download', 'ollama')}
                >
                  Official download
                  <ExternalLink size={14} />
                </Button>
              </InstallRow>
              <InstallRow
                title="OpenCode"
                detail="Connects the model to file edits and agent tools · installer size varies"
                done={inspection.opencodeInstalled}
                activity={status('opencode')}
                pending={activity === 'opencode' && !!busy}
              >
                {inspection.canInstall && (
                  <Button
                    variant="outline"
                    disabled={!desktop || !!busy}
                    onClick={() => install('opencode')}
                  >
                    Install OpenCode
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => void openLink('https://opencode.ai/docs/', 'opencode')}
                >
                  Official setup
                  <ExternalLink size={14} />
                </Button>
              </InstallRow>
              <InstallRow
                title={model.name}
                detail={
                  installed
                    ? 'Already downloaded in Ollama'
                    : `About ${formatSize(model.downloadBytes)} to download`
                }
                done={!!installed}
                activity={status('model')}
                pending={activity === 'model' && !!busy}
              >
                <Button
                  disabled={!desktop || !!busy || !inspection.ollamaOnline}
                  onClick={() =>
                    void perform('model', 'Downloading your model…', async () => {
                      await withProgress('local_ai_pull');
                      await inspect();
                    })
                  }
                >
                  <Download size={16} />
                  Download model
                </Button>
              </InstallRow>
            </div>
            {!inspection.ollamaOnline && (
              <p className="local-ai-caption">
                After installing, open Ollama from your applications and choose Check again.
                Jackalope will connect when its local service is ready.
              </p>
            )}
            {inspection.canInstall && (
              <p className="local-ai-caption">
                Install buttons use Windows Package Manager and accept the selected package’s
                installation agreements.
              </p>
            )}
            {inspection.hardware.freeDiskBytes !== null &&
              inspection.hardware.freeDiskBytes <
                model.downloadBytes + inspection.runtimeDiskBytes && (
                <p className="local-ai-notice">
                  <CircleAlert size={18} />
                  Free space may be too low. Free up space or change Ollama’s model location before
                  downloading.
                </p>
              )}
            <Button
              variant="ghost"
              disabled={!desktop || !!busy}
              onClick={() =>
                void perform('inspect', 'Checking installed tools…', async () => {
                  await inspect();
                })
              }
            >
              <RefreshCw size={16} />
              Check again
            </Button>
            {status('inspect')}
          </>
        )}
        {step === 3 && !connected && (
          <>
            <p>
              We’ll ask the local agent to create a small test file and continue the same session in
              a disposable folder. Your projects are not used for this check.
            </p>
            <p className="local-ai-caption">
              The first check can take several minutes and may download OpenCode components.
            </p>
            <div className="local-ai-check-visual" aria-hidden="true">
              <Cpu size={28} />
              <span />
              <Monitor size={28} />
              <span />
              <CheckCircle2 size={28} />
            </div>
            {verification ? (
              <p className="local-ai-notice local-ai-success">
                <CheckCircle2 size={20} />
                File editing and session continuation passed in{' '}
                {(verification.elapsedMs / 1000).toFixed(1)} seconds. This checks the connection; it
                does not establish quality on your project.
              </p>
            ) : (
              <Button
                disabled={!desktop || !!busy}
                onClick={() =>
                  void perform('verify', 'Checking your local agent…', async () => {
                    const result = await withProgress<LocalVerification>('local_ai_verify');
                    if (active.current) setVerification(result);
                  })
                }
              >
                <Sparkles size={16} />
                Run local check
              </Button>
            )}
            {status('verify')}
            {status('connect')}
            <p className="local-ai-caption">
              Connecting selects this local account and model for future OpenCode tasks. Other
              agents and existing sessions keep their settings. If your default agent is
              unavailable, OpenCode also becomes the default for Ask Jackalope.{' '}
              {projectSetup
                ? 'Its local account will be selected for this project.'
                : 'Choose its local account in your project to try it.'}{' '}
              This profile has no automatic paid-model fallback.
            </p>
          </>
        )}
        {connected && (
          <>
            <div className="local-ai-complete">
              <CheckCircle2 size={42} />
            </div>
            <p>
              {projectSetup ? 'Selected' : 'Choose'} <strong>OpenCode</strong> and{' '}
              <strong>Local · {selected}</strong>{' '}
              {projectSetup ? 'for this project.' : 'in your project.'} Start with a small,
              reviewable task. You can manage its account and model in Agents.
            </p>
            <p className="local-ai-caption">
              To reclaim model space later, remove the downloaded model and its Jackalope copy in
              Ollama. The local account can be removed in Jackalope’s agent settings.
            </p>
          </>
        )}
      </div>
      <footer className="local-ai-footer">
        {!connected && (
          <Button
            variant="ghost"
            onClick={step > 0 && !connected ? () => setStep(step - 1) : onClose}
            disabled={!!busy && step > 0}
          >
            {step > 0 && !connected ? (
              <>
                <ArrowLeft size={16} />
                Back
              </>
            ) : (
              'Cancel setup'
            )}
          </Button>
        )}
        {connected ? (
          <Button onClick={onClose}>
            Done
            <Check size={16} />
          </Button>
        ) : step < 3 ? (
          <Button
            disabled={
              !!busy ||
              !inspection ||
              (step === 2 &&
                (!installed || !inspection.ollamaOnline || !inspection.opencodeInstalled))
            }
            onClick={() => setStep(step + 1)}
          >
            {step === 0 ? 'Choose a model' : step === 1 ? 'Review setup' : 'Check connection'}
            <ArrowRight size={16} />
          </Button>
        ) : (
          <Button disabled={!verification || !!busy || !desktop} onClick={connect}>
            Connect local agent
            <ArrowRight size={16} />
          </Button>
        )}
      </footer>
    </>
  );
}

function Hardware({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div>
      {icon}
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{detail}</span>
    </div>
  );
}
function ModelChoice({
  model,
  inspection,
  selected,
  onSelect,
}: {
  model: LocalModel;
  inspection: LocalInspection;
  selected: boolean;
  onSelect: () => void;
}) {
  const fit = modelFit(model, inspection);
  return (
    <label className="local-ai-model" data-selected={selected}>
      <input
        type="radio"
        name="local-model"
        value={model.id}
        checked={selected}
        onChange={onSelect}
      />
      <div>
        <strong>{model.name}</strong>
        <p>{model.description}</p>
        <span className="local-ai-model-meta">
          <span>
            <Download size={14} />
            {formatSize(model.downloadBytes)}
          </span>
          <span>
            <MemoryStick size={14} />
            {model.recommendedMemoryGb} GB memory suggested
          </span>
        </span>
      </div>
      <span className={`local-ai-fit local-ai-fit-${fit}`}>
        {fit === 'fits'
          ? 'Meets memory guide'
          : fit === 'limited'
            ? 'May exceed memory'
            : 'Check memory'}
      </span>
    </label>
  );
}
function InstallRow({
  title,
  detail,
  done,
  activity,
  pending,
  children,
}: {
  title: string;
  detail: string;
  done: boolean;
  activity?: React.ReactNode;
  pending?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="local-ai-install-row">
      <span className="local-ai-install-icon">
        {done ? <CheckCircle2 size={21} /> : <Download size={21} />}
      </span>
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
        {activity}
      </div>
      {!pending && (
        <div className="local-ai-install-actions">
          {done ? <span className="local-ai-fit">Detected</span> : children}
        </div>
      )}
    </div>
  );
}

function SetupStatus({
  label,
  progress,
  elapsed,
  stopping,
  error,
  onStop,
}: {
  label: string;
  progress: LocalProgress | null;
  elapsed: number;
  stopping: boolean;
  error: string;
  onStop?: () => Promise<void>;
}) {
  const percent = downloadPercent(progress);
  return (
    <div className="local-ai-activity">
      {label && (
        <>
          <div className="local-ai-activity-heading" role="status">
            <Loader2 size={16} className="local-ai-spin" />
            <span>{stopping ? 'Stopping…' : progress?.message || label}</span>
          </div>
          <small>
            {elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`}{' '}
            elapsed
          </small>
          {progress && (progress.total || progress.phase === 'download') && (
            <>
              <progress
                aria-label={progress.phase === 'download' ? 'Model download' : 'Installer download'}
                value={percent}
                max={100}
              />
              <small>
                {formatSize(progress.completed)}
                {progress.total ? ` of ${formatSize(progress.total)}` : ' received'}
              </small>
            </>
          )}
          {onStop && (
            <Button variant="ghost" disabled={stopping} onClick={() => void onStop()}>
              Stop
            </Button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="local-ai-error">
          <CircleAlert size={18} />
          {error}
        </p>
      )}
    </div>
  );
}
