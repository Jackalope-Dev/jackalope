import { applyThemeTokens, type ThemePalette } from '@jackalope/brand/theme';
import { Badge, Disclosure, DisclosureSummary, Input, RefreshIcon, Textarea } from '@jackalope/ui';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FolderOpen,
  FolderPlus,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { builtinAgents, getAgentMetadata } from '../../lib/agent-catalog';
import { type CommitPolicy, projectGitPolicy } from '../../lib/project-git';
import { createProject, openProject } from '../../lib/project-setup';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { accountProfiles, useAgentAccountsStore } from '../../stores/agentAccountsStore';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import { useMascotStore } from '../../stores/mascotStore';
import { type OnboardingStep, useOnboardingStore } from '../../stores/onboardingStore';
import { useProjectStore } from '../../stores/projectStore';
import { useThemeStore } from '../../stores/themeStore';
import { AgentAvatar } from '../agents/AgentAvatar';
import { LocalAiSetup } from '../agents/LocalAiSetup';
import { ResizeHandles } from '../layout/ResizeHandles';
import { TitleBar } from '../layout/TitleBar';
import { JackalopeMascot } from '../mascot/JackalopeMascot';
import { ProjectGitSettings } from '../projects/ProjectGitSettings';
import { WorkspaceReadiness } from '../tasks/WorkspaceReadiness';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Switch } from '../ui/Switch';
import { OnboardingAgentAccount } from './OnboardingAgentAccount';
import { ProjectThemeStep } from './ProjectThemeStep';
import './onboarding.css';

const steps: { id: OnboardingStep; label: string }[] = [
  { id: 'project', label: 'Project' },
  { id: 'agent', label: 'Agents' },
  { id: 'theme', label: 'Appearance' },
  { id: 'task', label: 'First task' },
];
const setupTips: Record<OnboardingStep, string[]> = {
  project: ['Choose the Git repository your agent will work in, or create a new project.'],
  agent: [
    'This preference belongs to this project. Other projects keep their own agent choices.',
    'Add agents, supported accounts and models later in Settings → Agents.',
  ],
  theme: [
    'Keep the app theme or give this project its own colors. Your choices are saved when setup finishes.',
  ],
  task: [
    'Describe the result you want. Choose a check so you can tell when the work is done.',
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
  const { projects } = useProjectStore();
  const project =
    onboarding.pendingProject ?? projects.find((item) => item.id === onboarding.projectId);
  const appTheme = useThemeStore((state) => state.appTheme);
  const [commitPolicy, setCommitPolicy] = useState<CommitPolicy>();
  const [themePreview, setThemePreview] = useState<ThemePalette>();
  const execution = useExecutionStore();
  const config = useAgentConfigStore();
  const accounts = useAgentAccountsStore((state) => state.agents);
  const [path, setPath] = useState(project?.path ?? '');
  const [projectMode, setProjectMode] = useState<'existing' | 'new'>('existing');
  const [projectName, setProjectName] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [defaultDirectory, setDefaultDirectory] = useState('');
  const [directoryError, setDirectoryError] = useState('');
  const [agent, setAgent] = useState(
    onboarding.pendingProject?.preferences?.preferredRunner ||
      (project && execution.drafts[project.id]?.agent) ||
      project?.preferences?.preferredRunner ||
      config.defaultMetaAgent,
  );
  const [allowedAgents, setAllowedAgents] = useState<string[] | null>(
    project?.preferences?.allowedAgents ?? null,
  );
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [commitOpen, setCommitOpen] = useState(true);
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
  const errorMessage = useRef<HTMLDivElement>(null);
  const tipIndex = useRef(0);
  const desktop = isTauriEnvironment();
  const step = !project ? 'project' : onboarding.step;
  const index = steps.findIndex((item) => item.id === step);
  const draft =
    onboarding.firstTask ?? (project ? (execution.drafts[project.id]?.prompt ?? '') : '');
  const preview =
    step === 'theme' && themePreview ? themePreview : (project?.preferences?.theme ?? appTheme);
  const previewProjectId = project?.id;
  useEffect(() => {
    if (!previewProjectId) return;
    useThemeStore.setState({ previewing: true });
    applyThemeTokens(preview);
    return () => {
      useThemeStore.setState({ previewing: false });
      applyThemeTokens(useThemeStore.getState().currentTheme);
    };
  }, [previewProjectId, preview]);
  const runner = execution.runners.find((item) => item.id === agent);
  const runnerAdapter = config.customAgents.find((custom) => custom.id === agent)?.adapter ?? agent;
  const available = (id: string) => {
    const options = config.runnerOptions[id];
    return (
      ['codex', 'claude', 'grok', 'opencode', 'antigravity', 'kimi'].includes(
        config.customAgents.find((custom) => custom.id === id)?.adapter ?? id,
      ) &&
      config.isAgentEnabled(id) &&
      !(options?.restrictModels && !options.models.some((model) => model.trim()))
    );
  };
  const projectEnabled = (id: string) => allowedAgents === null || allowedAgents.includes(id);
  const detectedAgents = execution.runners.filter((item) => item.available && available(item.id));
  const recommendedAgent =
    detectedAgents.find((item) => item.id === agent && projectEnabled(item.id)) ??
    detectedAgents.find((item) => item.signedIn && projectEnabled(item.id)) ??
    detectedAgents.find((item) => projectEnabled(item.id));
  const recommendedId = recommendedAgent?.id;
  useEffect(() => {
    if (
      recommendedId &&
      !execution.discovering &&
      !detectedAgents.some((item) => item.id === agent)
    )
      setAgent(recommendedId);
  }, [recommendedId, execution.discovering, agent, detectedAgents]);
  const installableAgents = builtinAgents.filter(
    (item) =>
      available(item.id) &&
      !execution.runners.some((runner) => runner.id === item.id && runner.available),
  );
  const invalidAccounts = detectedAgents.some((item) => {
    if (!projectEnabled(item.id)) return false;
    const adapter = config.customAgents.find((custom) => custom.id === item.id)?.adapter ?? item.id;
    const entry = accounts[adapter];
    if (!entry?.view) return false;
    const enabled = accountProfiles(entry.view, entry.statuses).filter(
      (account) =>
        !config.disabledAccounts[adapter]?.includes(account.id) &&
        !project?.preferences?.disabledAccounts?.[adapter]?.includes(account.id),
    );
    const selected = project?.preferences?.agentAccounts?.[adapter];
    return !enabled.length || (!!selected && !enabled.some((account) => account.id === selected));
  });
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
    onboarding.stageProject(project, draft);
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
                loading={execution.discovering}
                loadingLabel="Scanning agents…"
              >
                <RefreshIcon size={16} />
                Re-scan agents
              </Button>
            )}
          </div>
          <h2 id="onboarding-heading" ref={heading} data-step={step} tabIndex={-1}>
            {step === 'project'
              ? 'Choose a project'
              : step === 'agent'
                ? 'Choose agents for this project'
                : step === 'theme'
                  ? 'Choose this project’s appearance'
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
                <InlineNotice>
                  Open the desktop app to create or choose a project and discover agents.
                </InlineNotice>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void attempt(async () => {
                    const opened =
                      projectMode === 'new'
                        ? await createProject(projectName, parentPath, { provisional: true })
                        : await openProject(path, {
                            provisional: true,
                            pending: onboarding.pendingProject,
                          });
                    onboarding.stageProject(
                      opened,
                      projectMode === 'new'
                        ? 'Help me plan what to build in this new project. Ask about my goals, then suggest a small first milestone.'
                        : opened.id === onboarding.projectId
                          ? draft
                          : (execution.drafts[opened.id]?.prompt ?? ''),
                    );
                    setAgent(opened.preferences?.preferredRunner ?? config.defaultMetaAgent);
                    setAllowedAgents(opened.preferences?.allowedAgents ?? null);
                    setPath(opened.path);
                    setProjectMode('existing');
                    setThemePreview(undefined);
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
                    <Input
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
                      <InlineNotice tone="error">{directoryError}</InlineNotice>
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
                      <Input
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
                    type="submit"
                    disabled={
                      !desktop ||
                      busy ||
                      (projectMode === 'new'
                        ? !projectName.trim() || (!parentPath && !defaultDirectory)
                        : !path.trim())
                    }
                    loading={busy}
                    loadingLabel={
                      projectMode === 'new' ? 'Creating project…' : 'Checking repository…'
                    }
                  >
                    {projectMode === 'new'
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
                Start with one available agent. You can add agents and change project defaults
                later.
              </p>
              <fieldset className="onboarding-runner-list" aria-label="Choose your project agent">
                {(showAllAgents
                  ? detectedAgents
                  : detectedAgents.filter((item) => item.id === recommendedId)
                ).map((item) => {
                  const adapter =
                    config.customAgents.find((custom) => custom.id === item.id)?.adapter ?? item.id;
                  const meta = getAgentMetadata(item.id);
                  return (
                    <div
                      className="onboarding-agent-card"
                      key={item.id}
                      data-selected={agent === item.id && projectEnabled(item.id)}
                    >
                      <div className="onboarding-agent-choice">
                        <button
                          type="button"
                          aria-pressed={agent === item.id}
                          disabled={!projectEnabled(item.id) || busy}
                          onClick={() => setAgent(item.id)}
                          className="onboarding-runner"
                        >
                          <span className="onboarding-radio">
                            {agent === item.id && <Check size={14} />}
                          </span>
                          <AgentAvatar provider={adapter} size="sm" />
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
                            <small>{item.detail || 'Installed'}</small>
                          </div>
                        </button>
                        {showAllAgents && (
                          <Switch
                            label={`Use ${item.name} in this project`}
                            checked={projectEnabled(item.id)}
                            disabled={busy}
                            onCheckedChange={(checked) => toggleAgent(item.id, checked)}
                          />
                        )}
                      </div>
                      {projectEnabled(item.id) && (
                        <OnboardingAgentAccount
                          agentId={adapter}
                          agentName={item.name}
                          value={project?.preferences?.agentAccounts?.[adapter]}
                          blocked={project?.preferences?.disabledAccounts?.[adapter]}
                          disabled={busy}
                          onChange={(id) => {
                            if (!project) return;
                            const agentAccounts = { ...project.preferences?.agentAccounts };
                            if (id) agentAccounts[adapter] = id;
                            else delete agentAccounts[adapter];
                            onboarding.stageProject({
                              ...project,
                              preferences: { ...project.preferences, agentAccounts },
                            });
                          }}
                        />
                      )}
                    </div>
                  );
                })}
                {!detectedAgents.length && (
                  <p className="task-muted" role="status">
                    {execution.discovering
                      ? 'Looking for installed agents…'
                      : 'No agents found yet. Install and sign in to your preferred agent, then re-scan agents.'}
                  </p>
                )}
              </fieldset>
              {detectedAgents.length > 1 && (
                <div className="onboarding-agents-toggle">
                  <Button
                    type="button"
                    variant="outline"
                    className="onboarding-toggle-agents-btn"
                    onClick={() => setShowAllAgents((value) => !value)}
                  >
                    {showAllAgents ? (
                      <>
                        <ChevronUp size={16} aria-hidden="true" />
                        <span>Show recommended agent only</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown size={16} aria-hidden="true" />
                        <span>Choose another agent</span>
                        <Badge variant="accent">{detectedAgents.length} detected</Badge>
                      </>
                    )}
                  </Button>
                </div>
              )}
              <div className="onboarding-local-agent">
                <LocalAiSetup
                  compact
                  projectSetup
                  onConnected={(profileId) => {
                    setAgent('opencode');
                    const nextAllowed =
                      allowedAgents === null ? null : [...new Set([...allowedAgents, 'opencode'])];
                    setAllowedAgents(nextAllowed);
                    if (project) {
                      onboarding.stageProject({
                        ...project,
                        preferences: {
                          ...project.preferences,
                          preferredRunner: 'opencode',
                          allowedAgents: nextAllowed ?? undefined,
                          agentAccounts: {
                            ...project.preferences?.agentAccounts,
                            opencode: profileId,
                          },
                        },
                      });
                    }
                  }}
                />
              </div>
              {!execution.runners.some(
                (item) => item.available && available(item.id) && projectEnabled(item.id),
              ) && (
                <p className="onboarding-note" role="status">
                  Enable at least one available agent to continue.
                </p>
              )}
              {execution.error && <InlineNotice tone="error">{execution.error}</InlineNotice>}
              {project && (
                <Disclosure
                  open={commitOpen}
                  onToggle={(event) => setCommitOpen(event.currentTarget.open)}
                >
                  <DisclosureSummary>Advanced · Git ownership and commits</DisclosureSummary>
                  <ProjectGitSettings
                    key={project.path}
                    projectPath={project.path}
                    onDraftChange={setCommitPolicy}
                    disabled={busy}
                  />
                </Disclosure>
              )}

              {runner && !runner.signedIn && runner.available && !accounts[runnerAdapter]?.view && (
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

              {installableAgents.length > 0 && (
                <Disclosure className="onboarding-install-catalog">
                  <DisclosureSummary>
                    Install other supported agents ({installableAgents.length} available)
                  </DisclosureSummary>
                  <div className="onboarding-catalog-grid">
                    {installableAgents.map((b) => (
                      <div key={b.id} className="onboarding-catalog-card">
                        <div className="onboarding-catalog-head">
                          <div className="flex items-center gap-2.5">
                            <AgentAvatar provider={b.id} size="xs" />
                            <div>
                              <strong>{b.name}</strong>
                              <span className="onboarding-vendor">{b.vendor}</span>
                            </div>
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
                </Disclosure>
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
                    !commitPolicy ||
                    invalidAccounts ||
                    !runner?.available ||
                    !available(agent) ||
                    !projectEnabled(agent)
                  }
                  onClick={() =>
                    void attempt(async () => {
                      if (!project || !commitPolicy) return;
                      await projectGitPolicy(project.path, commitPolicy);
                      setThemePreview(undefined);
                      onboarding.stageProject(
                        {
                          ...project,
                          preferences: {
                            ...project.preferences,
                            preferredRunner: agent,
                            allowedAgents: allowedAgents ?? undefined,
                          },
                        },
                        draft,
                      );
                      advance(() => onboarding.go('theme'));
                    })
                  }
                >
                  Continue
                  <ArrowRight size={16} />
                </Button>
              </div>
            </>
          )}
          {step === 'theme' && project && (
            <ProjectThemeStep
              key={project.id}
              initialTheme={project.preferences?.theme}
              appTheme={appTheme}
              busy={busy}
              onPreview={setThemePreview}
              onBack={() => {
                setThemePreview(undefined);
                onboarding.go('agent');
              }}
              onContinue={(theme) => {
                onboarding.stageProject(
                  { ...project, preferences: { ...project.preferences, theme } },
                  draft,
                );
                advance(() => onboarding.go('task'));
              }}
            />
          )}
          {step === 'task' && (
            <>
              <div className="flex items-center gap-3 my-4">
                {runner && <AgentAvatar provider={runnerAdapter} size="sm" />}
                <div>
                  <strong className="block text-sm text-[var(--color-text-primary)]">
                    {runner?.name ?? 'Your agent'}
                  </strong>
                  <span className="text-xs text-[var(--color-text-secondary)]">
                    {project?.name}
                  </span>
                </div>
              </div>
              <label htmlFor="onboarding-prompt" className="task-label">
                Your first task (optional)
              </label>
              <Textarea
                id="onboarding-prompt"
                className="task-input onboarding-prompt"
                placeholder="What would you like to build, fix or understand?"
                value={draft}
                disabled={busy}
                onChange={(event) => {
                  onboarding.setFirstTask(event.target.value);
                }}
              />
              {project && <WorkspaceReadiness project={project} mode="setup" />}
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  onboarding.setFirstTask(
                    'Explore this repository and explain its architecture, how to run it, and a useful first improvement. Do not edit files or commit changes.',
                  );
                }}
              >
                Start with a codebase walkthrough
              </Button>
              <div className="onboarding-actions">
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setThemePreview(undefined);
                    onboarding.go('theme');
                  }}
                >
                  <ArrowLeft size={16} />
                  Back
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (project) onboarding.stageProject(project, draft);
                    advance(onSkip);
                  }}
                >
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
            <InlineNotice tone="error" className="mt-4" ref={errorMessage} tabIndex={-1}>
              {error}
            </InlineNotice>
          )}
        </section>
      </main>
    </div>
  );
}
