import { RefreshIcon } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowRight,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  Plus,
  Settings2,
  Star,
  Terminal,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { builtinAgents } from '../../lib/agent-catalog';
import { openCliTerminal } from '../../lib/cli-terminal';
import { isActive, type Runner, type TaskRun } from '../../lib/task-runtime';
import { isTauriEnvironment, openInBrowser } from '../../lib/tauri-bridge';
import { accountProfiles, useAgentAccountsStore } from '../../stores/agentAccountsStore';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { accountForAgent, useCapacityStore } from '../../stores/capacityStore';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { AddAgentForm } from '../agents/AddAgentForm';
import { AgentInstallGuide } from '../agents/AgentInstallGuide';
import { LocalAiSetup } from '../agents/LocalAiSetup';
import { ProviderConnections } from '../agents/ProviderConnections';
import { ProviderMark } from '../agents/ProviderMark';
import { openAgentConfiguration, openProjectSettings, openSettings } from '../layout/navigation';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';
import { EmptyState } from '../ui/EmptyState';
import { InlineNotice } from '../ui/InlineNotice';
import { LoadingState } from '../ui/LoadingState';
import { Switch } from '../ui/Switch';
import { useDialogFocus } from '../ui/useDialogFocus';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import '../agents/agents-workspace.css';

function SetupCommandBox({
  command,
  label,
  workingDir,
}: {
  command: string;
  label: string;
  workingDir?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard access might be restricted
    }
  };
  const runInTerminal = () => {
    void openCliTerminal(workingDir || '');
  };
  return (
    <div className="agent-setup-box">
      <div className="agent-setup-header">
        <span className="agent-setup-label">{label}</span>
        <div className="agent-setup-actions">
          <button
            type="button"
            className={`agent-setup-btn ${copied ? 'agent-setup-btn-copied' : ''}`}
            onClick={() => void copy()}
            title={copied ? 'Copied' : 'Copy command'}
            aria-label={copied ? 'Copied to clipboard' : 'Copy command to clipboard'}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          {workingDir ? (
            <button
              type="button"
              className="agent-setup-btn"
              onClick={runInTerminal}
              title="Open a Jackalope terminal in this project. It does not run the command."
              aria-label="Open a Jackalope terminal in this project"
            >
              <Terminal size={12} />
              Terminal
            </button>
          ) : null}
        </div>
      </div>
      <div className="agent-setup-cmd-row">
        <code className="agent-setup-cmd" title={command}>
          {command}
        </code>
      </div>
    </div>
  );
}

export function RunnerConnections({
  onNewTask,
  onRun,
}: {
  onNewTask: (agent: string) => void;
  onRun: (run: TaskRun) => void;
}) {
  const { runners, runs, discovering, discover, error } = useExecutionStore(
    useShallow((s) => ({
      runners: s.runners,
      runs: s.runs,
      discovering: s.discovering,
      discover: s.discover,
      error: s.error,
    })),
  );
  const config = useAgentConfigStore(
    useShallow((s) => ({
      defaultMetaAgent: s.defaultMetaAgent,
      customAgents: s.customAgents,
      isAgentEnabled: s.isAgentEnabled,
      runnerOptions: s.runnerOptions,
      disabledAccounts: s.disabledAccounts,
      toggleAgent: s.toggleAgent,
    })),
  );
  const { projects, activeProjectId } = useProjectStore(
    useShallow((s) => ({ projects: s.projects, activeProjectId: s.activeProjectId })),
  );
  const project = projects.find((item) => item.id === activeProjectId);
  const defaultAgent = project ? project.preferences?.preferredRunner : config.defaultMetaAgent;
  const capacity = useCapacityStore();
  const accounts = useAgentAccountsStore((state) => state.agents);
  const accountAgents = JSON.stringify([
    ...new Set(
      runners
        .filter((runner) => runner.available)
        .map(
          (runner) =>
            config.customAgents.find((agent) => agent.id === runner.id)?.adapter ?? runner.id,
        ),
    ),
  ]);
  const [adding, setAdding] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const dialogFocus = useDialogFocus();
  const desktop = isTauriEnvironment();
  useEffect(() => {
    if (!desktop) return;
    for (const agent of JSON.parse(accountAgents) as string[])
      void useAgentAccountsStore.getState().load(agent);
  }, [desktop, accountAgents]);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void syncAgentConfig()
      .then(() => discover(false))
      .catch((cause) => {
        if (active) setCheckError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [desktop, discover]);
  const checkAgents = async () => {
    setChecking(true);
    setCheckError('');
    try {
      await syncAgentConfig();
      await discover();
      for (const agent of JSON.parse(accountAgents) as string[])
        void useAgentAccountsStore.getState().load(agent, true);
    } catch (error) {
      setCheckError(String(error));
    } finally {
      setChecking(false);
    }
  };
  const allAgents = [...builtinAgents, ...config.customAgents];
  const allRunners: Runner[] = allAgents.map((agent) => {
    const existing = runners.find((r) => r.id === agent.id);
    if (existing) return existing;
    return {
      id: agent.id,
      name: agent.name,
      desktopInstalled: false,
      available: false,
      signedIn: false,
      account: '',
      detail:
        'installCommand' in agent && agent.installCommand
          ? `Install ${agent.name} CLI to connect.`
          : 'Install and configure this agent.',
    };
  });

  const isRunnerReady = (runner: Runner) => {
    const enabled = config.isAgentEnabled(runner.id, project?.id);
    const options = config.runnerOptions[runner.id];
    const blockedModels = options?.restrictModels && !options.models.some((m) => m.trim());
    const needsSignIn = !runner.signedIn && runner.detail.startsWith('Sign in ');
    const isReadyStatus = runner.signedIn || runner.detail.startsWith('Ready.');
    return runner.available && enabled && !blockedModels && !needsSignIn && isReadyStatus;
  };

  const readyRunners = allRunners.filter(
    (runner) =>
      isRunnerReady(runner) || runs.some((run) => run.agent === runner.id && isActive(run)),
  );
  const setupRunners = allRunners.filter((runner) => !readyRunners.some((r) => r.id === runner.id));
  const checkAll = async () => {
    await checkAgents();
    void capacity.fetch(false);
    for (const agent of JSON.parse(accountAgents) as string[]) {
      const entry = useAgentAccountsStore.getState().agents[agent];
      if (!entry?.view) continue;
      for (const profile of accountProfiles(entry.view, entry.statuses))
        void useAgentAccountsStore.getState().check(agent, profile.id);
    }
  };

  const renderAgentCard = (runner: Runner, isSetupCard = false) => {
    const custom = config.customAgents.find((agent) => agent.id === runner.id);
    const builtin = builtinAgents.find((agent) => agent.id === runner.id);
    const provider = custom?.adapter ?? runner.id;
    const vendor = builtin?.vendor ?? (custom ? 'Custom agent' : undefined);
    const agentRuns = runs.filter(
      (run) => run.agent === runner.id && (!project || run.projectId === project.id),
    );
    const activeRuns = agentRuns.filter(isActive);
    const waitingRun = activeRuns.find((run) =>
      run.prompts?.some((prompt) => prompt.status === 'pending'),
    );
    const reviewRun = agentRuns.find((run) => run.status === 'review');
    const enabled = config.isAgentEnabled(runner.id, project?.id);
    const options = config.runnerOptions[runner.id];
    const blockedModels = options?.restrictModels && !options.models.some((model) => model.trim());
    const needsSignIn = !runner.signedIn && runner.detail.startsWith('Sign in ');
    const canStart = runner.available && enabled && !blockedModels && !needsSignIn;
    const working = activeRuns.length > 0;
    const status = waitingRun
      ? 'Needs your input'
      : working
        ? activeRuns.every((run) => run.status === 'stopping')
          ? 'Stopping'
          : activeRuns.every((run) => run.status === 'starting')
            ? 'Starting'
            : 'Working'
        : !enabled
          ? 'Disabled'
          : blockedModels
            ? 'Choose allowed models'
            : !runner.available
              ? runner.desktopInstalled
                ? 'CLI setup needed'
                : 'CLI not found'
              : needsSignIn
                ? 'Sign-in needed'
                : null;
    const detail = working
      ? `${activeRuns.length} active ${activeRuns.length === 1 ? 'task' : 'tasks'}`
      : !enabled
        ? config.isAgentEnabled(runner.id)
          ? 'Enable this agent for this project.'
          : 'Disabled in app settings.'
        : blockedModels
          ? 'The allowed model list is empty.'
          : !runner.available || needsSignIn
            ? runner.detail
            : null;
    const attention = !!waitingRun || (!working && !canStart);
    const taskToOpen = waitingRun ?? activeRuns[0] ?? reviewRun;
    const knownAccount = accountForAgent(capacity.records, runner.id);
    const genericAccount = !runner.account || runner.account === 'Current CLI account';
    const identity = knownAccount ?? (genericAccount ? null : runner.account);
    const accountData = accounts[provider];
    const profiles = accountData?.view
      ? accountProfiles(accountData.view, accountData.statuses).filter(
          (profile) =>
            !config.disabledAccounts[provider]?.includes(profile.id) &&
            !project?.preferences?.disabledAccounts?.[provider]?.includes(profile.id) &&
            (!project?.preferences?.agentAccounts?.[provider] ||
              project.preferences.agentAccounts[provider] === profile.id),
        )
      : [];
    const accountLabels = profiles.map((profile) => {
      const idStr = accountData?.statuses[profile.id]?.identity;
      return idStr && idStr !== profile.name ? `${profile.name} · ${idStr}` : idStr || profile.name;
    });

    return (
      <article
        key={runner.id}
        className="agent-roster-row"
        data-provider={provider}
        data-default={(defaultAgent === runner.id && enabled) || undefined}
      >
        <button
          type="button"
          className="agent-configure"
          onClick={() => openAgentConfiguration(runner.id)}
          title={`Configure ${custom?.name ?? runner.name}`}
          aria-label={`Configure ${custom?.name ?? runner.name}`}
        >
          <Settings2 size={16} />
        </button>
        <span className="agent-roster-mark" aria-hidden="true">
          <ProviderMark provider={provider} size={32} />
        </span>
        <div className="agent-roster-identity">
          <div className="agent-roster-name">
            <h2>{custom?.name ?? runner.name}</h2>
            {defaultAgent === runner.id && enabled && (
              <span className="agent-default">
                <Star size={12} />
                Default agent
              </span>
            )}
            {custom && <span className="agent-custom">Manual</span>}
          </div>
          {vendor && <p className="agent-roster-vendor">{vendor}</p>}
          {status && (
            <p className="agent-presence" data-attention={attention || undefined}>
              {attention && <CircleAlert size={15} />}
              {status}
            </p>
          )}
          {detail && <p className="task-muted">{detail}</p>}

          {profiles.length > 0 ? (
            <button
              type="button"
              className="agent-account-summary"
              onClick={() => openAgentConfiguration(runner.id)}
              title={accountLabels.join('\n')}
              aria-label={`Manage ${profiles.length} ${runner.name} ${profiles.length === 1 ? 'account' : 'accounts'}`}
            >
              <span>
                {profiles.length} {profiles.length === 1 ? 'account' : 'accounts'}
              </span>
              {accountLabels.slice(0, 2).map((label, index) => (
                <span key={profiles[index].id} className="agent-account-summary-identity">
                  {label}
                </span>
              ))}
              {profiles.length > 2 && <span>+{profiles.length - 2} more</span>}
            </button>
          ) : identity ? (
            <p className="task-muted text-xs">{identity}</p>
          ) : null}
          {accountData?.error && (
            <p className="task-muted text-xs">Account list unavailable. Open Configure to retry.</p>
          )}
          {taskToOpen && (
            <Button
              variant="ghost"
              size="sm"
              className="agent-task-action"
              onClick={() => onRun(taskToOpen)}
            >
              {waitingRun ? 'Respond to task' : working ? 'View task' : 'Review task'}
              {taskToOpen.projectId !== project?.id && ` in ${taskToOpen.projectName}`}
              <ArrowRight size={14} />
            </Button>
          )}
        </div>

        {/* Setup guidance for missing CLI or sign-in */}
        {isSetupCard && !runner.available && builtin?.installCommand ? (
          <SetupCommandBox
            command={builtin.installCommand}
            label="Install command"
            workingDir={project?.path}
          />
        ) : null}
        {isSetupCard && runner.available && needsSignIn && builtin?.loginCommand ? (
          <SetupCommandBox
            command={builtin.loginCommand}
            label="Sign-in command"
            workingDir={project?.path}
          />
        ) : null}

        <div className="agent-roster-action">
          <div className="agent-enable">
            <Switch
              checked={enabled}
              disabled={!desktop || (!!project && !config.isAgentEnabled(runner.id))}
              onCheckedChange={(value) => {
                setCheckError('');
                config.toggleAgent(runner.id, value, project?.id);
                void syncAgentConfig().catch((cause) => setCheckError(String(cause)));
              }}
              label={`Enable ${custom?.name ?? runner.name}${project ? ` for ${project.name}` : ' app-wide'}`}
            />
            <span aria-hidden="true">{enabled ? 'Enabled' : 'Disabled'}</span>
          </div>
          {!canStart &&
          runner.id === 'antigravity' &&
          runner.desktopInstalled &&
          !runner.available ? (
            <AgentInstallGuide desktopInstalled compact />
          ) : !canStart && builtin?.installUrl && !runner.available ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openInBrowser(builtin.installUrl)}
            >
              Setup guide
              <ExternalLink size={14} />
            </Button>
          ) : needsSignIn && enabled ? (
            <Button
              aria-label={`Sign in to ${custom?.name ?? runner.name}`}
              onClick={() => openAgentConfiguration(runner.id)}
            >
              Sign in
              <ArrowRight size={16} />
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={!canStart}
              title={canStart ? undefined : (detail ?? status ?? undefined)}
              aria-label={`New task with ${custom?.name ?? runner.name}`}
              onClick={() => onNewTask(runner.id)}
            >
              New task
              <ArrowRight size={16} />
            </Button>
          )}
        </div>
      </article>
    );
  };

  return (
    <WorkspacePage className="agents-page">
      <div className="agents-page-content workspace-stack">
        <WorkspaceHeading
          title="Agents"
          description={project ? `Agent choices for ${project.name}` : 'App-wide agent settings'}
          action={
            <div className="workspace-actions">
              <Button onClick={() => setAdding(true)}>
                <Plus size={18} />
                Add agent
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  project ? openProjectSettings(project.id, 'Agents') : openSettings('Agents')
                }
              >
                {project ? 'Project agent settings' : 'Agent settings'}
              </Button>
              <Button
                variant="outline"
                disabled={!desktop || checking || discovering || capacity.loading}
                onClick={() => void checkAll()}
                title="Finds installed agents, then reads each account's identity and remaining capacity."
                loading={checking || discovering || capacity.loading}
                loadingLabel="Checking…"
              >
                <RefreshIcon size={16} />
                Check again
              </Button>
            </div>
          }
        />
        {(checkError || error || capacity.error) && (
          <InlineNotice tone="error">{checkError || error || capacity.error}</InlineNotice>
        )}
        {!desktop && <p className="task-muted">Agent discovery requires the desktop app.</p>}
        {allRunners.length === 0 && (discovering || checking) ? (
          <LoadingState label="Looking for your agents…" />
        ) : allRunners.length === 0 ? (
          <EmptyState
            icon={Plus}
            title="No agents identified yet"
            action={
              <Button variant="outline" onClick={() => setAdding(true)}>
                <Plus size={18} />
                Add an agent
              </Button>
            }
          />
        ) : (
          <div className="workspace-stack" style={{ gap: '28px' }}>
            {readyRunners.length > 0 && (
              <section className="agent-roster-section" aria-label="Ready agents">
                <div className="agent-roster-section-header">
                  <div className="agent-roster-section-title">
                    <span>Ready</span>
                    <span className="agent-roster-count">{readyRunners.length}</span>
                  </div>
                </div>
                <div className="agent-roster">
                  {readyRunners.map((runner) => renderAgentCard(runner, false))}
                </div>
              </section>
            )}

            {setupRunners.length > 0 && (
              <section className="agent-roster-section" aria-label="Agents needing setup">
                <div className="agent-roster-section-header">
                  <div className="agent-roster-section-title">
                    <span>Needs setup</span>
                    <span className="agent-roster-count">{setupRunners.length}</span>
                  </div>
                </div>
                <div className="agent-roster">
                  {setupRunners.map((runner) => renderAgentCard(runner, true))}
                </div>
              </section>
            )}
          </div>
        )}
        <ProviderConnections />
        <LocalAiSetup compact />
      </div>
      <Dialog.Root open={adding} onOpenChange={setAdding}>
        <DialogContent {...dialogFocus}>
          <DialogCloseButton label="Close add agent" />
          <DialogHeader
            title="Add an agent"
            description={<>Give your installed agent a name and tell Jackalope where to find it.</>}
          />
          <AddAgentForm
            onCancel={() => setAdding(false)}
            onAdded={() => {
              setAdding(false);
              if (desktop) void checkAgents();
            }}
          />
        </DialogContent>
      </Dialog.Root>
    </WorkspacePage>
  );
}
