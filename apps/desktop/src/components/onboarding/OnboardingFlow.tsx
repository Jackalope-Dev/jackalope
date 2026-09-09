import { applyThemeTokens } from '@jackalope/brand/theme';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { builtinAgents, getAgentMetadata } from '../../lib/agent-catalog';
import { createProject, openProject } from '../../lib/project-setup';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { useCommunityStore } from '../../stores/communityStore';
import { useExecutionStore } from '../../stores/executionStore';
import { useMascotStore } from '../../stores/mascotStore';
import { type OnboardingStep, useOnboardingStore } from '../../stores/onboardingStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { ResizeHandles } from '../layout/ResizeHandles';
import { TitleBar } from '../layout/TitleBar';
import { JackalopeMascot } from '../mascot/JackalopeMascot';
import { type AccountStatus, JackalopeAccount } from '../settings/JackalopeAccount';
import { PrivacySettings } from '../settings/PrivacySettings';
import { ArcColorPicker } from '../theme/ArcColorPicker';
import { ThemeEditor } from '../theme/ThemeEditor';
import { Button } from '../ui/button';
import { Switch } from '../ui/Switch';
import './onboarding.css';

const steps: { id: OnboardingStep; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'theme', label: 'Theme' },
  { id: 'project', label: 'Project' },
  { id: 'agent', label: 'Agent' },
  { id: 'task', label: 'First task' },
];
const setupTips: Record<OnboardingStep, string[]> = {
  account: ['Connect your Jackalope account to check early access. Settings sync is optional.'],
  theme: [
    'Theme changes are a preview until you choose Keep theme and continue.',
    'Try a palette, then adjust its accent and atmosphere to make it yours.',
  ],
  project: [
    'Choose the Git repository your agent will work in, or create a new project.',
    'Open Manage privacy settings to review usage sharing before continuing.',
  ],
  agent: [
    'Your default is the starting choice for new tasks. Projects and tasks can use another agent.',
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
  const { projects, activeProjectId } = useProjectStore();
  const project = projects.find((item) => item.id === activeProjectId);
  const execution = useExecutionStore();
  const config = useAgentConfigStore();
  const settings = useSettingsStore();
  const community = useCommunityStore();
  const theme = useThemeStore();
  const [themeDraft, setThemeDraft] = useState(theme.currentTheme);
  const sharing = community.settings?.reviewed
    ? community.settings.telemetry
    : settings.telemetryEnabled;
  const [path, setPath] = useState(project?.path ?? '');
  const [projectMode, setProjectMode] = useState<'existing' | 'new'>('existing');
  const [projectName, setProjectName] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [defaultDirectory, setDefaultDirectory] = useState('');
  const [directoryError, setDirectoryError] = useState('');
  const [agent, setAgent] = useState(
    (project && execution.drafts[project.id]?.agent) || config.defaultMetaAgent,
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
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [access, setAccess] = useState<{ required: boolean; allowed: boolean } | null>(null);
  useEffect(() => {
    let canceled = false;
    const check = async () => {
      try {
        const value = desktop
          ? await nativeTask<{ required: boolean; allowed: boolean }>('app_execution_access')
          : { required: false, allowed: true };
        if (!canceled) setAccess(value);
      } catch {
        if (!canceled) setAccess(null);
      }
    };
    void check();
    const timer = setInterval(() => void check(), 2000);
    return () => {
      canceled = true;
      clearInterval(timer);
    };
  }, [desktop]);
  const needsAccount = !access || (access.required && !access.allowed);
  const step =
    needsAccount || onboarding.step === 'account'
      ? 'account'
      : onboarding.step === 'theme'
        ? 'theme'
        : !project
          ? 'project'
          : onboarding.step;
  useEffect(() => {
    if (step !== 'theme') return;
    useThemeStore.setState({ previewing: true });
    return () => {
      useThemeStore.setState({ previewing: false });
    };
  }, [step]);
  const index = steps.findIndex((item) => item.id === step);
  const draft = project ? (execution.drafts[project.id]?.prompt ?? '') : '';
  const runner = execution.runners.find((item) => item.id === agent);
  const available = (id: string) => {
    const options = config.runnerOptions[id];
    return (
      ['codex', 'claude', 'grok', 'opencode'].includes(
        config.customAgents.find((custom) => custom.id === id)?.adapter ?? id,
      ) &&
      config.isAgentEnabled(id) &&
      !(options?.restrictModels && !options.models.some((model) => model.trim()))
    );
  };
  useEffect(() => {
    if (step === 'theme') setThemeDraft(useThemeStore.getState().currentTheme);
  }, [step]);
  useEffect(() => {
    if (step !== 'theme') return;
    applyThemeTokens(themeDraft);
    return () => applyThemeTokens(useThemeStore.getState().currentTheme);
  }, [step, themeDraft]);
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
    if (!project || !runner?.available || !available(agent)) {
      onboarding.go('agent');
      return;
    }
    if (!draft.trim()) return;
    execution.draft(project.id, { agent: '', projectId: project.id });
    execution.select(null);
    advance(() => onFinish('', project.id));
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
        {step !== 'theme' && step !== 'account' && <ArcColorPicker />}
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
            {step === 'account'
              ? 'Connect your account'
              : step === 'theme'
                ? 'Choose your theme'
                : step === 'project'
                  ? 'Choose a project'
                  : step === 'agent'
                    ? 'Choose a default agent for Jackalope'
                    : 'Describe your first task'}
          </h2>
          {step === 'account' && (
            <>
            <p className="onboarding-description">
              Connect your Jackalope account to check whether you have early access.
            </p>
            <p className="onboarding-note">Settings sync is on for new connections. You can turn it off in Manage privacy settings below before connecting.</p>
              <JackalopeAccount presentation="onboarding" onStatus={setAccount} />
              <details className="onboarding-privacy-panel">
                <summary>
                  <ShieldCheck size={20} aria-hidden="true" />
                  <span>
                    <strong>Manage privacy settings</strong>
                    <small>Choose settings sync and usage sharing.</small>
                  </span>
                  <ChevronDown
                    size={18}
                    className="onboarding-privacy-chevron"
                    aria-hidden="true"
                  />
                </summary>
                <div className="onboarding-privacy-controls">
                  <PrivacySettings />
                </div>
              </details>
              {!access && <p role="status">Checking access…</p>}
              {access?.required && !access.allowed && account?.state === 'offline' && (
                <p role="status">Reconnect online to verify access before continuing setup.</p>
              )}
              {access && !access.required && account?.state !== 'connected' && (
                <p className="onboarding-note">
                  This development build can continue without an account.
                </p>
              )}
              <div className="onboarding-actions">
                <Button
                  disabled={busy || !access || (access.required && !access.allowed)}
                  onClick={() => advance(() => onboarding.go('theme'))}
                >
                  {account?.state === 'connected'
                    ? 'Continue'
                    : access && !access.required
                      ? 'Continue without an account'
                      : 'Continue after approval'}
                  <ArrowRight size={16} />
                </Button>
              </div>
            </>
          )}
          {step === 'theme' && (
            <>
              <ThemeEditor value={themeDraft} onChange={setThemeDraft} />
              <div className="onboarding-actions">
                <Button variant="ghost" disabled={busy} onClick={() => onboarding.go('account')}>
                  Back
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setThemeDraft(theme.currentTheme)}
                >
                  Reset preview
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void attempt(async () => {
                      theme.setTheme(themeDraft);
                      advance(() => onboarding.go('project'));
                    })
                  }
                >
                  {busy ? 'Saving…' : 'Keep theme and continue'}
                  <ArrowRight size={16} />
                </Button>
              </div>
            </>
          )}
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
                  if (community.busy) return;
                  void attempt(async () => {
                    await community.applyDefaults();
                    const privacy = useCommunityStore.getState();
                    if (desktop && (!privacy.settings?.reviewed || privacy.error))
                      throw new Error(
                        privacy.error ?? 'Privacy settings could not be saved. Please retry.',
                      );
                    const opened =
                      projectMode === 'new'
                        ? await createProject(projectName, parentPath)
                        : await openProject(path);
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
                <details className="onboarding-privacy-panel">
                  <summary>
                    <ShieldCheck size={20} aria-hidden="true" />
                    <span>
                      <strong>Manage privacy settings</strong>
                      <small>
                        {community.error
                          ? 'Usage sharing is paused. Review your settings.'
                          : sharing
                            ? 'Anonymous usage sharing is on by default. Opt out here.'
                            : 'Anonymous usage sharing is off.'}
                      </small>
                    </span>
                    <ChevronDown
                      size={18}
                      className="onboarding-privacy-chevron"
                      aria-hidden="true"
                    />
                  </summary>
                  <div className="onboarding-privacy-controls">
                    <PrivacySettings />
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
                  </div>
                </details>
                <div className="onboarding-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onboarding.go('theme')}
                  >
                    <ArrowLeft size={16} />
                    Back
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      !desktop ||
                      busy ||
                      community.busy ||
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
                Your default agent coordinates Jackalope’s automatic task routing. You can configure
                multiple agents and accounts per project. It chooses among enabled agents,
                configured models and accounts based on the task and reported quota headroom.
              </p>
              <fieldset className="onboarding-runner-list" aria-label="Choose your default agent">
                {execution.runners.map((item) => {
                  const workerOnly = !['codex', 'claude', 'grok', 'opencode'].includes(
                    config.customAgents.find((custom) => custom.id === item.id)?.adapter ?? item.id,
                  );
                  const enabled = available(item.id) && !workerOnly;
                  const meta = getAgentMetadata(item.id);
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
                      <div className="onboarding-runner-info">
                        <div className="onboarding-runner-header">
                          <strong>{item.name}</strong>
                          {meta?.vendor && <span className="onboarding-vendor">{meta.vendor}</span>}
                        </div>
                        <small>
                          {workerOnly
                            ? 'Routing coordinator not supported'
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
                    busy || execution.discovering || !runner?.available || !available(agent)
                  }
                  onClick={() =>
                    void attempt(async () => {
                      const previousDefault = useAgentConfigStore.getState().defaultMetaAgent;
                      config.setDefaultMetaAgent(agent);
                      try {
                        await syncAgentConfig();
                      } catch (cause) {
                        if (useAgentConfigStore.getState().defaultMetaAgent === agent)
                          useAgentConfigStore.setState({ defaultMetaAgent: previousDefault });
                        throw cause;
                      }
                      if (project) execution.draft(project.id, { agent: '' });
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
