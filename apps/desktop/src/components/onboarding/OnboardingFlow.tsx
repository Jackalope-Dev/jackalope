import { ArrowLeft, ArrowRight, Check, FolderOpen, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { openProject } from '../../lib/project-setup';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import { type OnboardingStep, useOnboardingStore } from '../../stores/onboardingStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { AgentManager } from '../agents/AgentManager';
import { ResizeHandles } from '../layout/ResizeHandles';
import { TitleBar } from '../layout/TitleBar';
import { JackalopeMascot } from '../mascot/JackalopeMascot';
import { ArcColorPicker } from '../theme/ArcColorPicker';
import { Button } from '../ui/button';
import { Switch } from '../ui/Switch';
import './onboarding.css';

const steps: { id: OnboardingStep; label: string }[] = [
  { id: 'project', label: 'Project' },
  { id: 'agent', label: 'Agent' },
  { id: 'task', label: 'First task' },
];

export function OnboardingFlow({
  onFinish,
  onCapture,
}: {
  onFinish: (agent?: string) => void;
  onCapture?: () => void;
}) {
  const onboarding = useOnboardingStore();
  const { projects, activeProjectId } = useProjectStore();
  const project = projects.find((item) => item.id === activeProjectId);
  const execution = useExecutionStore();
  const config = useAgentConfigStore();
  const settings = useSettingsStore();
  const [path, setPath] = useState(project?.path ?? '');
  const [agent, setAgent] = useState(
    (project && execution.drafts[project.id]?.agent) || config.defaultMetaAgent,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const desktop = isTauriEnvironment();
  const step = !project ? 'project' : onboarding.step;
  const index = steps.findIndex((item) => item.id === step);
  const draft = project ? (execution.drafts[project.id]?.prompt ?? '') : '';
  const runner = execution.runners.find((item) => item.id === agent);
  const available = (id: string) => {
    const options = config.runnerOptions[id];
    return (
      config.isAgentEnabled(id) &&
      !(options?.restrictModels && !options.models.some((model) => model.trim()))
    );
  };

  useEffect(() => {
    if (heading.current?.dataset.step === step) heading.current.focus();
    setError('');
  }, [step]);
  useEffect(() => {
    if (error) errorMessage.current?.focus();
  }, [error]);

  const attempt = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const refresh = () =>
    attempt(async () => {
      await syncAgentConfig();
      await execution.discover();
    });
  const finish = () => {
    if (!project || !runner?.available || !available(agent)) {
      onboarding.go('agent');
      return;
    }
    execution.draft(project.id, { agent });
    execution.select(null);
    onFinish(agent);
  };

  return (
    <div className="onboarding-shell">
      <ResizeHandles />
      <TitleBar />
      <header className="onboarding-topbar">
        <span className="onboarding-wordmark">
          <img src="/mascot.svg" alt="" />
          Jackalope
        </span>
        <ArcColorPicker />
      </header>
      <main className="onboarding-layout">
        <aside className="onboarding-intro" aria-label="Setup progress">
          <JackalopeMascot size="md" overrideMood={busy ? 'thinking' : 'idle'} />
          <h1>Set up Jackalope</h1>
          <ol className="onboarding-steps">
            {steps.map((item, itemIndex) => (
              <li key={item.id} aria-current={step === item.id ? 'step' : undefined}>
                <span className="onboarding-step-number">
                  {itemIndex < index ? <Check size={16} /> : itemIndex + 1}
                </span>
                <strong>{item.label}</strong>
              </li>
            ))}
          </ol>
        </aside>
        <section className="onboarding-content" aria-labelledby="onboarding-heading">
          <p className="onboarding-progress">
            Step {index + 1} of {steps.length}
          </p>
          <h2 id="onboarding-heading" ref={heading} data-step={step} tabIndex={-1}>
            {step === 'project'
              ? 'Choose a project'
              : step === 'agent'
                ? 'Choose an agent'
                : 'Describe your first task'}
          </h2>
          {step === 'project' && (
            <>
              <p className="onboarding-description">
                Choose a local Git repository. Jackalope keeps its tasks, agent work and changes
                together.
              </p>
              {!desktop && (
                <p className="task-notice">
                  Open the desktop app to choose a repository and discover agents. You can still
                  explore the workspace.
                </p>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void attempt(async () => {
                    const opened = await openProject(path);
                    setPath(opened.path);
                    onboarding.go('agent');
                    await execution.discover();
                  });
                }}
              >
                <label className="task-label" htmlFor="onboarding-path">
                  Repository folder
                </label>
                <div className="onboarding-folder">
                  <input
                    id="onboarding-path"
                    className="task-input"
                    placeholder="Paste a repository path"
                    value={path}
                    disabled={!desktop || busy}
                    onChange={(event) => setPath(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!desktop || busy}
                    onClick={() =>
                      void attempt(async () => {
                        const selected = await nativeTask<string | null>('task_pick_project');
                        if (selected) setPath(selected);
                      })
                    }
                  >
                    <FolderOpen size={16} />
                    Browse
                  </Button>
                </div>
                <div className="onboarding-privacy">
                  <div>
                    <label htmlFor="onboarding-marketplace">Community tools</label>
                    <p>
                      Allow browsing the MCP marketplace at allmcps.com. Your source code and
                      prompts aren’t sent to the marketplace.
                    </p>
                  </div>
                  <Switch
                    id="onboarding-marketplace"
                    label="Allow MCP marketplace"
                    checked={settings.useMcpMarketplace}
                    onCheckedChange={settings.setUseMcpMarketplace}
                  />
                </div>
                <p className="onboarding-note">
                  Opening a project does not start an agent or change your files.
                </p>
                <div className="onboarding-actions">
                  <Button type="submit" disabled={!desktop || busy || !path.trim()}>
                    {busy ? 'Checking repository…' : 'Continue with this project'}
                    <ArrowRight size={16} />
                  </Button>
                </div>
              </form>
            </>
          )}
          {step === 'agent' && (
            <>
              <p className="onboarding-description">
                Jackalope works with agents installed on this computer. Choose one for{' '}
                <strong>{project?.name}</strong>.
              </p>
              <fieldset className="onboarding-runner-list" aria-label="Choose your agent">
                {execution.runners.map((item) => {
                  const enabled = available(item.id);
                  return (
                    <button
                      type="button"
                      key={item.id}
                      aria-pressed={agent === item.id}
                      disabled={!item.available || !enabled || busy}
                      onClick={() => setAgent(item.id)}
                      className="onboarding-runner"
                    >
                      <span className="onboarding-radio">
                        {agent === item.id && <Check size={14} />}
                      </span>
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {!enabled
                            ? 'Disabled in agent or model settings'
                            : !item.available
                              ? 'Not installed or not found'
                              : item.signedIn
                                ? 'Installed · sign-in detected'
                                : 'Installed · sign-in not confirmed'}
                        </small>
                        <small>{item.detail}</small>
                      </span>
                    </button>
                  );
                })}
                {!execution.runners.length && (
                  <p className="task-muted" role="status">
                    {execution.discovering
                      ? 'Looking for installed agents…'
                      : 'No agents found yet. Install and sign in to your preferred agent, or configure its command below.'}
                  </p>
                )}
              </fieldset>
              {execution.error && (
                <p className="task-error" role="alert">
                  {execution.error}
                </p>
              )}
              <details className="onboarding-advanced">
                <summary>Agent commands, models & manual setup</summary>
                <AgentManager />
              </details>
              <Button
                variant="ghost"
                disabled={busy || execution.discovering || !desktop}
                onClick={() => void refresh()}
              >
                <RefreshCw size={15} />
                {execution.discovering ? 'Checking agents…' : 'Check again'}
              </Button>
              <p className="onboarding-note">
                If sign-in isn’t confirmed, finish signing in through your agent’s CLI before
                starting a task.
              </p>
              <div className="onboarding-actions">
                <Button variant="ghost" disabled={busy} onClick={() => onboarding.go('project')}>
                  <ArrowLeft size={16} />
                  Back
                </Button>
                <Button
                  disabled={
                    busy || execution.discovering || !runner?.available || !available(agent)
                  }
                  onClick={() =>
                    void attempt(async () => {
                      await syncAgentConfig();
                      if (project) execution.draft(project.id, { agent });
                      onboarding.go('task');
                    })
                  }
                >
                  Continue
                  <ArrowRight size={16} />
                </Button>
              </div>
            </>
          )}
          {step === 'task' && (
            <>
              <p className="onboarding-description">
                Give {runner?.name ?? 'your agent'} a clear first step in{' '}
                <strong>{project?.name}</strong>. You’ll review the task and workspace before
                starting.
              </p>
              <label htmlFor="onboarding-prompt" className="task-label">
                Your first task
              </label>
              <textarea
                id="onboarding-prompt"
                className="task-input onboarding-prompt"
                placeholder="What would you like to build, fix or understand?"
                value={draft}
                onChange={(event) => {
                  if (project) execution.draft(project.id, { prompt: event.target.value });
                }}
              />
              <Button
                variant="ghost"
                onClick={() => {
                  if (project)
                    execution.draft(project.id, {
                      prompt:
                        'Explore this repository and explain its architecture, how to run it, and a useful first improvement. Do not edit files or commit changes.',
                    });
                }}
              >
                Start with a codebase walkthrough
              </Button>
              <div className="onboarding-explanation">
                <p>
                  New tasks use an isolated worktree by default. Follow the agent’s progress,
                  inspect its changes, then decide what to keep.
                </p>
              </div>
              <div className="onboarding-actions">
                <Button variant="ghost" onClick={() => onboarding.go('agent')}>
                  <ArrowLeft size={16} />
                  Back
                </Button>
                <Button disabled={!draft.trim()} onClick={finish}>
                  Review first task
                  <ArrowRight size={16} />
                </Button>
              </div>
            </>
          )}
          {error && (
            <p className="task-error mt-4" role="alert" ref={errorMessage} tabIndex={-1}>
              {error}
            </p>
          )}
        </section>
      </main>
      <footer className="onboarding-footer">
        <span>You can return to guided setup in Settings.</span>
        {onCapture && (
          <Button variant="outline" disabled={busy} onClick={onCapture}>
            Capture an idea first
          </Button>
        )}
        <Button variant="ghost" disabled={busy} onClick={() => onFinish()}>
          {step === 'task' ? 'Finish without a task' : 'Skip setup for now'}
        </Button>
      </footer>
    </div>
  );
}
