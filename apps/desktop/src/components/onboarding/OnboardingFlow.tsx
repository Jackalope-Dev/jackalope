import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  FolderPlus,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { builtinAgents, getAgentMetadata } from '../../lib/agent-catalog';
import { createProject, openProject } from '../../lib/project-setup';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import { useMascotStore } from '../../stores/mascotStore';
import { type OnboardingStep, useOnboardingStore } from '../../stores/onboardingStore';
import { useProjectStore } from '../../stores/projectStore';
import { ResizeHandles } from '../layout/ResizeHandles';
import { TitleBar } from '../layout/TitleBar';
import { JackalopeMascot } from '../mascot/JackalopeMascot';
import { Button } from '../ui/button';
import { Switch } from '../ui/Switch';
import './onboarding.css';

const steps: { id: OnboardingStep; label: string }[] = [
  { id: 'project', label: 'Project' },
  { id: 'agent', label: 'Agent' },
  { id: 'task', label: 'First task' },
];
const setupTips: Record<OnboardingStep, string[]> = {
  project: ['Choose the Git repository your agent will work in, or create a new project.'],
  agent: [
    'This preference belongs to this project. Other projects keep their own agent choices.',
    'Add agents, supported accounts and models later in Settings → Agents.',
  ],
  task: [
    'Describe the result you want, relevant files, and how to check the work.',
    'Your first task opens as a draft. Review it in the workspace before starting.',
  ],
};
export function OnboardingFlow({
  onFinish,
  onSkip,
}: {
  onFinish: (agent: string, draftKey: string) => void;
  onSkip: () => void;
}) {
  const onboarding = useOnboardingStore();
  const { projects, updateProjectPreferences } = useProjectStore();
  const project = projects.find((item) => item.id === onboarding.projectId);
  const execution = useExecutionStore();
  const config = useAgentConfigStore();
  const [path, setPath] = useState(project?.path ?? '');
  const [projectMode, setProjectMode] = useState<'existing' | 'new'>('existing');
  const [projectName, setProjectName] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [defaultDirectory, setDefaultDirectory] = useState('');
  const [directoryError, setDirectoryError] = useState('');
  const [agent, setAgent] = useState(
    (project && execution.drafts[project.id]?.agent) ||
      project?.preferences?.preferredRunner ||
      config.defaultMetaAgent,
  );
  const [allowedAgents, setAllowedAgents] = useState<string[] | null>(
    project?.preferences?.allowedAgents ?? null,
  );
  const [working, setBusy] = useState(false);
  const [nodding, setNodding] = useState(false);
  const pendingAdvance = useRef<(() => void) | null>(null);
  const attempting = useRef(false);
  const busy = working || nodding;
  const [error, setError] = useState('');
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedCommand(text);
    setTimeout(() => setCopiedCommand((curr) => (curr === text ? null : curr)), 2500);
  };
  const heading = useRef<HTMLHeadingElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const tipIndex = useRef(0);
  const desktop = isTauriEnvironment();
  const step = !project ? 'project' : onboarding.step;
  const index = steps.findIndex((item) => item.id === step);
  const draft = project ? (execution.drafts[project.id]?.prompt ?? '') : '';
  const runner = execution.runners.find((item) => item.id === agent);
  const available = (id: string) => {
    const options = config.runnerOptions[id];
    return (
      ['codex', 'claude', 'grok', 'opencode', 'antigravity'].includes(
        config.customAgents.find((custom) => custom.id === id)?.adapter ?? id,
      ) &&
      config.isAgentEnabled(id) &&
      !(options?.restrictModels && !options.models.some((model) => model.trim()))
    );
  };
  const projectEnabled = (id: string) => allowedAgents === null || allowedAgents.includes(id);
  const toggleAgent = (id: string, enabled: boolean) => {
    const current =
      allowedAgents ??
      execution.runners
        .filter((item) => item.available && available(item.id))
        .map((item) => item.id);
    const next = enabled ? [...new Set([...current, id])] : current.filter((item) => item !== id);
    setAllowedAgents(next);
    if (!enabled && agent === id)
      setAgent(
        execution.runners.find(
          (item) => item.available && available(item.id) && next.includes(item.id),
        )?.id ?? '',
      );
    else if (enabled && !agent) setAgent(id);
  };
  useEffect(() => {
    if (!desktop || projectMode !== 'new') return;
    void nativeTask<string>('task_project_directory')
      .then((directory) => {
        setDefaultDirectory(directory);
        setDirectoryError('');
      })
      .catch(() => setDirectoryError('Choose a folder for your new project.'));
  }, [desktop, projectMode]);
  useEffect(() => {
    if (heading.current?.dataset.step === step) heading.current.focus();
    setError('');
    tipIndex.current = 0;
    useMascotStore.getState().clearMessage();
    return () => useMascotStore.getState().clearMessage();
  }, [step]);
  useEffect(() => {
    if (error) errorMessage.current?.focus();
  }, [error]);
  const advance = (action: () => void) => {
    if (pendingAdvance.current) return;
    pendingAdvance.current = action;
    setNodding(true);
  };
  const completeNod = useCallback(() => {
    const action = pendingAdvance.current;
    pendingAdvance.current = null;
    setNodding(false);
    action?.();
  }, []);
  useEffect(
    () => () => {
      pendingAdvance.current = null;
    },
    [],
  );
  const attempt = async (action: () => Promise<void>) => {
    if (attempting.current || pendingAdvance.current) return;
    attempting.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(String(cause));
    } finally {
      attempting.current = false;
      setBusy(false);
    }
  };
  const refresh = () =>
    attempt(async () => {
      await syncAgentConfig();
      await execution.discover();
    });
  const finish = () => {
    if (!project || !runner?.available || !available(agent) || !projectEnabled(agent)) {
      onboarding.go('agent');
      return;
    }
    if (!draft.trim()) return;
    execution.draft(project.id, { agent, projectId: project.id });
    execution.select(null);
    advance(() => onFinish(agent, project.id));
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
      </header>
      <main className="onboarding-layout">
        <aside className="onboarding-intro" aria-label="Setup progress">
          <JackalopeMascot
            size="md"
            className="w-fit"
            bubbleAlign="start"
            overrideMood={working && !nodding ? 'thinking' : 'idle'}
            nodding={nodding}
            onNodComplete={completeNod}
            label="Show setup tip"
            onActivate={() => {
              const tips = setupTips[step];
              useMascotStore.getState().say(tips[tipIndex.current % tips.length]);
              tipIndex.current += 1;
            }}
          />
          <h1>Set up your project</h1>
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
          <div className="onboarding-step-meta">
            <p className="onboarding-progress">
              Step {index + 1} of {steps.length}
            </p>
            {step === 'agent' && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || execution.discovering || !desktop}
                onClick={() => void refresh()}
              >
                <RefreshCw size={15} />
                {execution.discovering ? 'Scanning agents…' : 'Re-scan agents'}
              </Button>
            )}
          </div>
          <h2 id="onboarding-heading" ref={heading} data-step={step} tabIndex={-1}>
            {step === 'project'
              ? 'Choose a project'
              : step === 'agent'
                ? 'Choose an agent for this project'
                : 'Describe your first task'}
          </h2>
          {step === 'project' && (
            <>
              <fieldset className="onboarding-project-options" aria-label="Project setup">
                <Button
                  variant={projectMode === 'existing' ? 'primary' : 'outline'}
                  aria-pressed={projectMode === 'existing'}
                  disabled={busy}
                  onClick={() => {
                    setProjectMode('existing');
                    setError('');
                  }}
                >
                  <FolderOpen size={16} />
                  Open existing
                </Button>
                <Button
                  variant={projectMode === 'new' ? 'primary' : 'outline'}
                  aria-pressed={projectMode === 'new'}
                  disabled={busy}
                  onClick={() => {
                    setProjectMode('new');
                    setError('');
                  }}
                >
                  <FolderPlus size={16} />
                  Create new project
                </Button>
              </fieldset>
              {!desktop && (
                <p className="task-notice">
                  Open the desktop app to create or choose a project and discover agents.
                </p>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void attempt(async () => {
                    const opened =
                      projectMode === 'new'
                        ? await createProject(projectName, parentPath)
                        : await openProject(path);
                    onboarding.selectProject(opened.id);
                    setAgent(opened.preferences?.preferredRunner ?? config.defaultMetaAgent);
                    setAllowedAgents(opened.preferences?.allowedAgents ?? null);
                    setPath(opened.path);
                    setProjectMode('existing');
                    if (projectMode === 'new') {
                      execution.draft(opened.id, {
                        prompt:
                          'Help me plan what to build in this new project. Ask about my goals, then suggest a small first milestone.',
                      });
                    }
                    await execution.discover();
                    advance(() => onboarding.go('agent'));
                  });
                }}
              >
                {projectMode === 'new' ? (
                  <>
                    <label className="task-label" htmlFor="onboarding-project-name">
                      Project name
                    </label>
                    <input
                      id="onboarding-project-name"
                      className="task-input onboarding-project-name"
                      placeholder="My new project"
                      maxLength={80}
                      required
                      value={projectName}
                      disabled={!desktop || busy}
                      onChange={(event) => setProjectName(event.target.value)}
                    />
                    <div className="onboarding-project-location">
                      <div>
                        <span className="task-label">Create in</span>
                        <p>
                          {parentPath ?? (defaultDirectory || 'Documents / Jackalope Projects')}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!desktop || busy}
                        onClick={() =>
                          void attempt(async () => {
                            const selected = await nativeTask<string | null>('task_pick_project');
                            if (selected) {
                              setParentPath(selected);
                              setDirectoryError('');
                            }
                          })
                        }
                      >
                        Change folder
                      </Button>
                    </div>
                    {directoryError && !parentPath && (
                      <p role="alert" className="task-error">
                        {directoryError}
                      </p>
                    )}
                    <p className="onboarding-note">
                      Creates a new folder with Git ready for your first task.
                    </p>
                  </>
                ) : (
                  <>
                    <label className="task-label" htmlFor="onboarding-path">
                      Repository folder
                    </label>
                    <div className="onboarding-folder">
                      <input
                        id="onboarding-path"
                        className="task-input"
                        placeholder="Paste a repository path"
                        value={path}
                        required
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
                  </>
                )}
                <div className="onboarding-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onboarding.finish()}
                  >
                    <ArrowLeft size={16} />
                    Cancel setup
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      !desktop ||
                      busy ||
                      (projectMode === 'new'
                        ? !projectName.trim() || (!parentPath && !defaultDirectory)
                        : !path.trim())
                    }
                  >
                    {busy
                      ? projectMode === 'new'
                        ? 'Creating project…'
                        : 'Checking repository…'
                      : projectMode === 'new'
                        ? 'Create project and continue'
                        : 'Continue with this project'}
                    <ArrowRight size={16} />
                  </Button>
                </div>
              </form>
            </>
          )}
          {step === 'agent' && (
            <>
              <p className="onboarding-description">
                Choose a default, then switch other detected agents on or off for this project.
                Change these choices later in Project settings.
              </p>
              <fieldset className="onboarding-runner-list" aria-label="Choose your project agent">
                {execution.runners.map((item) => {
                  const workerOnly = ![
                    'codex',
                    'claude',
                    'grok',
                    'opencode',
                    'antigravity',
                  ].includes(
                    config.customAgents.find((custom) => custom.id === item.id)?.adapter ?? item.id,
                  );
                  const enabled = available(item.id) && !workerOnly;
                  const meta = getAgentMetadata(item.id);
                  return (
                    <div className="onboarding-agent-choice" key={item.id}>
                      <button
                        type="button"
                        aria-pressed={agent === item.id}
                        disabled={!item.available || !enabled || !projectEnabled(item.id) || busy}
                        onClick={() => setAgent(item.id)}
                        className="onboarding-runner"
                      >
                        <span className="onboarding-radio">
                          {agent === item.id && <Check size={14} />}
                        </span>
                        <div className="onboarding-runner-info">
                          <div className="onboarding-runner-header">
                            <strong>{item.name}</strong>
                            {agent === item.id && projectEnabled(item.id) && (
                              <span className="onboarding-vendor">Default</span>
                            )}
                            {meta?.vendor && (
                              <span className="onboarding-vendor">{meta.vendor}</span>
                            )}
                          </div>
                          <small>
                            {workerOnly
                              ? 'Execution is not supported by this agent yet'
                              : !enabled
                                ? 'Disabled in agent or model settings'
                                : !item.available
                                  ? 'Not installed or not found'
                                  : item.signedIn
                                    ? 'Installed · sign-in detected'
                                    : 'Installed · sign-in not confirmed'}
                          </small>
                          <small>{item.detail}</small>
                        </div>
                      </button>
                      <Switch
                        label={`Use ${item.name} in this project`}
                        checked={item.available && enabled && projectEnabled(item.id)}
                        disabled={!item.available || !enabled || busy}
                        onCheckedChange={(checked) => toggleAgent(item.id, checked)}
                      />
                    </div>
                  );
                })}
                {!execution.runners.length && (
                  <p className="task-muted" role="status">
                    {execution.discovering
                      ? 'Looking for installed agents…'
                      : 'No agents found yet. Install and sign in to your preferred agent, then re-scan agents.'}
                  </p>
                )}
              </fieldset>
              {!execution.runners.some(
                (item) => item.available && available(item.id) && projectEnabled(item.id),
              ) && (
                <p className="onboarding-note" role="status">
                  Enable at least one available agent to continue.
                </p>
              )}
              {execution.error && (
                <p className="task-error" role="alert">
                  {execution.error}
                </p>
              )}
              <p className="onboarding-note">
                Add more agents, supported accounts and models in <strong>Settings → Agents</strong>
                . Choose the agents and accounts each project uses in{' '}
                <strong>Project settings</strong>.
              </p>

              {runner && !runner.signedIn && runner.available && (
                <div className="onboarding-signin-tip">
                  <p className="onboarding-note">
                    Sign in through {runner.name} before starting a task.
                  </p>
                  {(() => {
                    const meta = getAgentMetadata(runner.id);
                    if (meta?.loginCommand) {
                      const loginCmd = meta.loginCommand;
                      return (
                        <div className="onboarding-command-box">
                          <code>{loginCmd}</code>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => copyToClipboard(loginCmd)}
                          >
                            {copiedCommand === loginCmd ? <Check size={13} /> : <Copy size={13} />}
                            {copiedCommand === loginCmd ? 'Copied' : 'Copy'}
                          </Button>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              )}

              {builtinAgents.filter(
                (b) => !execution.runners.some((r) => r.id === b.id && r.available),
              ).length > 0 && (
                <details className="onboarding-install-catalog">
                  <summary>
                    Install other supported agents (
                    {
                      builtinAgents.filter(
                        (b) => !execution.runners.some((r) => r.id === b.id && r.available),
                      ).length
                    }{' '}
                    available)
                  </summary>
                  <div className="onboarding-catalog-grid">
                    {builtinAgents
                      .filter((b) => !execution.runners.some((r) => r.id === b.id && r.available))
                      .map((b) => (
                        <div key={b.id} className="onboarding-catalog-card">
                          <div className="onboarding-catalog-head">
                            <div>
                              <strong>{b.name}</strong>
                              <span className="onboarding-vendor">{b.vendor}</span>
                            </div>
                            <a
                              href={b.installUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="onboarding-catalog-link"
                              title={`Open ${b.name} docs`}
                            >
                              <ExternalLink size={14} />
                            </a>
                          </div>
                          <p className="onboarding-catalog-desc">{b.description}</p>
                          {b.installCommand &&
                            (() => {
                              const instCmd = b.installCommand;
                              return (
                                <div className="onboarding-command-box">
                                  <code>{instCmd}</code>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => copyToClipboard(instCmd)}
                                  >
                                    {copiedCommand === instCmd ? (
                                      <Check size={13} />
                                    ) : (
                                      <Copy size={13} />
                                    )}
                                    {copiedCommand === instCmd ? 'Copied' : 'Copy'}
                                  </Button>
                                </div>
                              );
                            })()}
                        </div>
                      ))}
                  </div>
                </details>
              )}

              <div className="onboarding-actions">
                <Button variant="ghost" disabled={busy} onClick={() => onboarding.go('project')}>
                  <ArrowLeft size={16} />
                  Back
                </Button>
                <Button
                  disabled={
                    busy ||
                    execution.discovering ||
                    !runner?.available ||
                    !available(agent) ||
                    !projectEnabled(agent)
                  }
                  onClick={() =>
                    void attempt(async () => {
                      if (!project) return;
                      const previous = {
                        preferredRunner: project.preferences?.preferredRunner,
                        allowedAgents: project.preferences?.allowedAgents,
                      };
                      updateProjectPreferences(project.id, {
                        preferredRunner: agent,
                        allowedAgents: allowedAgents ?? undefined,
                      });
                      try {
                        await syncAgentConfig();
                      } catch (cause) {
                        updateProjectPreferences(project.id, previous);
                        throw cause;
                      }
                      execution.draft(project.id, { agent });
                      advance(() => onboarding.go('task'));
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
                {runner?.name ?? 'Your agent'} · <strong>{project?.name}</strong>
              </p>
              <label htmlFor="onboarding-prompt" className="task-label">
                Your first task (optional)
              </label>
              <textarea
                id="onboarding-prompt"
                className="task-input onboarding-prompt"
                placeholder="What would you like to build, fix or understand?"
                value={draft}
                disabled={busy}
                onChange={(event) => {
                  if (project) execution.draft(project.id, { prompt: event.target.value });
                }}
              />
              <Button
                variant="ghost"
                disabled={busy}
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
              <div className="onboarding-actions">
                <Button variant="ghost" disabled={busy} onClick={() => onboarding.go('agent')}>
                  <ArrowLeft size={16} />
                  Back
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => advance(onSkip)}>
                  Skip for now
                </Button>
                <Button disabled={busy || !draft.trim()} onClick={finish}>
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
    </div>
  );
}
