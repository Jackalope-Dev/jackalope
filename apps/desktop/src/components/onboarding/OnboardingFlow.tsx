import { applyThemeTokens, type ThemePalette } from '@jackalope/brand/theme';
import { RefreshIcon, Textarea } from '@jackalope/ui';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { builtinAgents, getAgentMetadata } from '../../lib/agent-catalog';
import { missingProjectDefaults, type ProjectDefaults } from '../../lib/context/project-defaults';
import { type CommitPolicy, projectGitPolicy } from '../../lib/project-git';
import { routingSettings } from '../../lib/routing-settings';
import { STARTER_PROMPTS } from '../../lib/starter-prompts';
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
import { RoutingSetup } from '../settings/RoutingSetup';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Switch } from '../ui/Switch';
import { AgentInstallCatalog, CommandCopy } from './AgentInstallCatalog';
import { OnboardingAgentAccount } from './OnboardingAgentAccount';
import { OnboardingProjectStep } from './OnboardingProjectStep';
import { ProjectThemeStep } from './ProjectThemeStep';
import './onboarding.css';

const steps: { id: OnboardingStep; label: string }[] = [
  { id: 'project', label: 'Project' },
  { id: 'agent', label: 'Agents' },
  { id: 'routing', label: 'Decisions' },
  { id: 'behavior', label: 'Behavior' },
  { id: 'theme', label: 'Appearance' },
  { id: 'task', label: 'First task' },
];
const setupTips: Record<OnboardingStep, string[]> = {
  project: ['Choose the Git repository your agent will work in, or create a new project.'],
  agent: [
    'This preference belongs to this project. Other projects keep their own agent choices.',
    'Add agents, supported accounts and models later in Settings → Agents.',
  ],
  routing: [
    'Choose how Automatic selects a worker. Your agents still write code and run checks. You can change this later in Settings → Decisions.',
  ],
  behavior: [
    'Set commit author attribution, checkpointing, and branch cleanup for this repository.',
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
  const { projects } = useProjectStore(useShallow((s) => ({ projects: s.projects })));
  const project =
    onboarding.pendingProject ?? projects.find((item) => item.id === onboarding.projectId);
  const appTheme = useThemeStore((state) => state.appTheme);
  const [commitPolicy, setCommitPolicy] = useState<CommitPolicy>();
  const [themePreview, setThemePreview] = useState<ThemePalette>();
  const execution = useExecutionStore(
    useShallow((s) => ({
      drafts: s.drafts,
      runners: s.runners,
      discovering: s.discovering,
      discover: s.discover,
      error: s.error,
    })),
  );
  const config = useAgentConfigStore(
    useShallow((s) => ({
      defaultMetaAgent: s.defaultMetaAgent,
      customAgents: s.customAgents,
      runnerOptions: s.runnerOptions,
      isAgentEnabled: s.isAgentEnabled,
      disabledAccounts: s.disabledAccounts,
    })),
  );
  const accounts = useAgentAccountsStore((state) => state.agents);
  const [agent, setAgent] = useState(
    onboarding.pendingProject?.preferences?.preferredRunner ||
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
  const [routingReady, setRoutingReady] = useState(false);
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
  const projectPath = project?.path;
  useEffect(() => {
    if (!desktop || !previewProjectId || !projectPath) return;
    let canceled = false;
    void nativeTask<ProjectDefaults>('project_readiness', { path: projectPath })
      .then((defaults) => {
        if (canceled) return;
        const current = useOnboardingStore.getState();
        if (current.status !== 'active' || current.projectId !== previewProjectId) return;
        const pending =
          current.pendingProject ??
          useProjectStore.getState().projects.find((item) => item.id === previewProjectId);
        if (!pending || pending.path !== projectPath) return;
        const missing = missingProjectDefaults(pending.preferences, defaults);
        if (Object.keys(missing).length)
          current.stageProject({
            ...pending,
            preferences: { ...pending.preferences, ...missing },
          });
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, [desktop, previewProjectId, projectPath]);
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
    heading.current?.closest('.onboarding-content')?.scrollTo({ top: 0 });
    if (heading.current?.dataset.step === step) heading.current.focus({ preventScroll: true });
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
  const completeSetup = async (action: () => void) => {
    if (onboarding.routingMode) {
      try {
        const current = await routingSettings.read(project?.id);
        if (onboarding.routingMode === 'jev' && !current.connected)
          throw new Error('Reconnect Jev or choose another decision method before continuing.');
        if (
          current.projectMode !== onboarding.routingMode ||
          current.jevFallback !== onboarding.routingFallback
        )
          await routingSettings.setMode(
            onboarding.routingMode,
            current.revision,
            project?.id,
            onboarding.routingFallback ?? 'local',
          );
      } catch (error) {
        onboarding.go('routing');
        throw error;
      }
    }
    advance(action);
  };
  const finish = () => {
    if (!project || !runner?.available || !available(agent) || !projectEnabled(agent)) {
      onboarding.go('agent');
      return;
    }
    if (!draft.trim()) return;
    onboarding.stageProject(project, draft);
    void attempt(() => completeSetup(() => onFinish(agent, project.id)));
  };
  return (
    <div className="onboarding-shell">
      <ResizeHandles />
      <TitleBar />
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
          <h2
            id="onboarding-heading"
            ref={heading}
            data-step={step}
            tabIndex={-1}
            className={step === 'behavior' ? 'sr-only' : undefined}
          >
            {step === 'project'
              ? 'Choose a project'
              : step === 'agent'
                ? 'Choose agents for this project'
                : step === 'routing'
                  ? 'Jackalope Decisions'
                  : step === 'behavior'
                    ? 'Commits and cleanup'
                    : step === 'theme'
                      ? 'Choose this project’s appearance'
                      : 'Describe your first task'}
          </h2>
          {step === 'project' && (
            <OnboardingProjectStep
              initialPath={project?.path ?? ''}
              pendingProject={onboarding.pendingProject}
              desktop={desktop}
              busy={busy}
              attempt={attempt}
              clearError={() => setError('')}
              onOpened={async (opened, created) => {
                onboarding.stageProject(
                  opened,
                  created
                    ? 'Help me plan what to build in this new project. Ask about my goals, then suggest a small first milestone.'
                    : opened.id === onboarding.projectId
                      ? draft
                      : (execution.drafts[opened.id]?.prompt ?? ''),
                );
                setAgent(opened.preferences?.preferredRunner ?? config.defaultMetaAgent);
                setAllowedAgents(opened.preferences?.allowedAgents ?? null);
                setThemePreview(undefined);
                await execution.discover();
                advance(() => onboarding.go('agent'));
              }}
            />
          )}
          {step === 'agent' && (
            <>
              <p className="onboarding-description">
                Start with one available agent. You can add agents and change project defaults
                later.
              </p>
              {(() => {
                const renderAgentCard = (item: (typeof detectedAgents)[number]) => {
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
                        <Switch
                          label={`Use ${item.name} in this project`}
                          checked={projectEnabled(item.id)}
                          disabled={busy}
                          onCheckedChange={(checked) => toggleAgent(item.id, checked)}
                        />
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
                };

                const localAi = (
                  <div className="onboarding-local-agent">
                    <LocalAiSetup
                      compact
                      projectSetup
                      onConnected={(profileId) => {
                        setAgent('opencode');
                        const nextAllowed =
                          allowedAgents === null
                            ? null
                            : [...new Set([...allowedAgents, 'opencode'])];
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
                );

                return (
                  <>
                    <fieldset
                      className="onboarding-runner-list"
                      aria-label="Choose your project agent"
                    >
                      {detectedAgents.map(renderAgentCard)}
                      {!detectedAgents.length && (
                        <p className="task-muted" role="status">
                          {execution.discovering
                            ? 'Looking for installed agents…'
                            : 'No agents found yet. Install and sign in to your preferred agent, then re-scan agents.'}
                        </p>
                      )}
                    </fieldset>
                    {localAi}
                    <AgentInstallCatalog agents={installableAgents} />
                  </>
                );
              })()}
              {!execution.runners.some(
                (item) => item.available && available(item.id) && projectEnabled(item.id),
              ) && (
                <p className="onboarding-note" role="status">
                  Enable at least one available agent to continue.
                </p>
              )}
              {execution.error && <InlineNotice tone="error">{execution.error}</InlineNotice>}

              {runner && !runner.signedIn && runner.available && !accounts[runnerAdapter]?.view && (
                <div className="onboarding-signin-tip">
                  <p className="onboarding-note">
                    Sign in through {runner.name} before starting a task.
                  </p>
                  {getAgentMetadata(runner.id)?.loginCommand && (
                    <CommandCopy command={getAgentMetadata(runner.id)?.loginCommand ?? ''} />
                  )}
                </div>
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
                    invalidAccounts ||
                    !runner?.available ||
                    !available(agent) ||
                    !projectEnabled(agent)
                  }
                  onClick={() =>
                    void attempt(async () => {
                      if (!project) return;
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
                      advance(() => onboarding.go('routing'));
                    })
                  }
                >
                  Continue
                  <ArrowRight size={16} />
                </Button>
              </div>
            </>
          )}
          {step === 'routing' && (
            <>
              <RoutingSetup
                key={project?.id}
                projectId={project?.id}
                mode={onboarding.routingMode}
                onModeChange={onboarding.setRoutingMode}
                jevFallback={onboarding.routingFallback}
                onFallbackChange={onboarding.setRoutingFallback}
                onReadyChange={setRoutingReady}
                disabled={busy}
              />
              <div className="onboarding-actions">
                <Button variant="ghost" disabled={busy} onClick={() => onboarding.go('agent')}>
                  <ArrowLeft size={16} />
                  Back
                </Button>
                <Button
                  disabled={busy || !routingReady}
                  onClick={() => advance(() => onboarding.go('behavior'))}
                >
                  Continue
                  <ArrowRight size={16} />
                </Button>
              </div>
            </>
          )}
          {step === 'behavior' && project && (
            <>
              <div className="onboarding-behavior-section">
                <ProjectGitSettings
                  key={project.path}
                  projectPath={project.path}
                  onDraftChange={setCommitPolicy}
                  disabled={busy}
                />
              </div>

              <div className="onboarding-actions">
                <Button variant="ghost" disabled={busy} onClick={() => onboarding.go('routing')}>
                  <ArrowLeft size={16} />
                  Back
                </Button>
                <Button
                  disabled={busy || !commitPolicy}
                  onClick={() =>
                    void attempt(async () => {
                      if (!commitPolicy) return;
                      await projectGitPolicy(project.path, commitPolicy);
                      setThemePreview(undefined);
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
                onboarding.go('behavior');
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
              {!draft.trim() && (
                <fieldset className="starter-chips" aria-label="Task ideas">
                  {STARTER_PROMPTS.map((starter) => (
                    <button
                      key={starter.label}
                      type="button"
                      className="starter-chip"
                      disabled={busy}
                      onClick={() => {
                        onboarding.setFirstTask(starter.prompt);
                        document.getElementById('onboarding-prompt')?.focus();
                      }}
                    >
                      {starter.label}
                    </button>
                  ))}
                </fieldset>
              )}
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
                    void attempt(() => completeSetup(onSkip));
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
