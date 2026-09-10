import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, CircleAlert, Plus, RefreshCw, Settings2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isActive, type Runner, type TaskRun } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { accountProfiles, useAgentAccountsStore } from '../../stores/agentAccountsStore';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { accountForAgent, useCapacityStore } from '../../stores/capacityStore';
import { useExecutionStore } from '../../stores/executionStore';
import { AddAgentForm } from '../agents/AddAgentForm';
import { AgentAvatar } from '../agents/AgentAvatar';
import { AgentInstallGuide } from '../agents/AgentInstallGuide';
import { LocalAiSetup } from '../agents/LocalAiSetup';
import { openAgentConfiguration } from '../layout/navigation';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { LoadingState } from '../ui/LoadingState';
import { useDialogFocus } from '../ui/useDialogFocus';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import '../agents/agents-workspace.css';

export function RunnerConnections({
  onNewTask,
  onRun,
}: {
  onNewTask: (agent: string) => void;
  onRun: (run: TaskRun) => void;
}) {
  const { runners, runs, discovering, discover, error } = useExecutionStore();
  const config = useAgentConfigStore();
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
  const identified: Runner[] = runners.filter(
    (runner) =>
      runner.available ||
      runner.desktopInstalled ||
      !config.isAgentEnabled(runner.id) ||
      config.customAgents.some((agent) => agent.id === runner.id) ||
      runs.some((run) => run.agent === runner.id && isActive(run)),
  );
  for (const agent of config.customAgents) {
    if (!identified.some((runner) => runner.id === agent.id)) {
      identified.push({
        id: agent.id,
        name: agent.name,
        available: false,
        signedIn: false,
        account: '',
        detail: 'Added manually · check this agent to confirm availability.',
      });
    }
  }
  const missing = runners.filter((runner) => !identified.some((agent) => agent.id === runner.id));
  return (
    <section className="task-page agents-page">
      <div className="agents-page-content">
        <WorkspaceHeading
          title="Agents"
          action={
            <div className="agent-workspace-actions">
              <Button variant="outline" onClick={() => setAdding(true)}>
                <Plus size={18} />
                Add agent
              </Button>
            </div>
          }
        />
        <LocalAiSetup />
        <div className="agent-roster-heading">
          <span>On this computer</span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={!desktop || capacity.loading}
              onClick={() => {
                void capacity.fetch(false);
                for (const agent of JSON.parse(accountAgents) as string[]) {
                  const entry = useAgentAccountsStore.getState().agents[agent];
                  if (entry?.view) {
                    for (const profile of accountProfiles(entry.view, entry.statuses))
                      void useAgentAccountsStore.getState().check(agent, profile.id);
                  } else void useAgentAccountsStore.getState().load(agent, true);
                }
              }}
              title="Reads each signed-in agent's account identity and remaining capacity."
            >
              <RefreshCw size={15} />
              {capacity.loading ? 'Checking…' : 'Check accounts'}
            </Button>
            <Button
              variant="ghost"
              disabled={!desktop || checking || discovering}
              onClick={() => void checkAgents()}
            >
              <RefreshCw size={15} />
              {checking || discovering ? 'Checking…' : 'Check agents'}
            </Button>
          </div>
        </div>
        {(checkError || error || capacity.error) && (
          <p role="alert" className="task-error">
            {checkError || error || capacity.error}
          </p>
        )}
        {!desktop && <p className="task-muted">Agent discovery requires the desktop app.</p>}
        {identified.length === 0 && (discovering || checking) ? (
          <LoadingState label="Looking for your agents…" />
        ) : identified.length === 0 ? (
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
          <div className="agent-roster">
            {identified.map((runner) => {
              const custom = config.customAgents.find((agent) => agent.id === runner.id);
              const provider = custom?.adapter ?? runner.id;
              const agentRuns = runs.filter((run) => run.agent === runner.id);
              const activeRuns = agentRuns.filter(isActive);
              const waitingRun = activeRuns.find((run) =>
                run.prompts?.some((prompt) => prompt.status === 'pending'),
              );
              const reviewRun = agentRuns.find((run) => run.status === 'review');
              const enabled = config.isAgentEnabled(runner.id);
              const options = config.runnerOptions[runner.id];
              const blockedModels =
                options?.restrictModels && !options.models.some((model) => model.trim());
              const needsSignIn = !runner.signedIn && runner.detail.startsWith('Sign in using');
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
                          : 'Not available'
                        : needsSignIn
                          ? 'Sign-in needed'
                          : null;
              const detail = working
                ? `${activeRuns.length} active ${activeRuns.length === 1 ? 'task' : 'tasks'}`
                : !enabled
                  ? 'Enable this agent in Settings.'
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
                ? accountProfiles(accountData.view, accountData.statuses)
                : [];
              const accountLabels = profiles.map((profile) => {
                const identity = accountData?.statuses[profile.id]?.identity;
                return identity && identity !== profile.name
                  ? `${profile.name} · ${identity}`
                  : identity || profile.name;
              });
              return (
                <article key={runner.id} className="agent-roster-row" data-provider={provider}>
                  <AgentAvatar
                    provider={provider}
                    working={working && !waitingRun}
                    waiting={!!waitingRun}
                  />
                  <div className="agent-roster-identity">
                    <div className="agent-roster-name">
                      <h2>{custom?.name ?? runner.name}</h2>
                      {config.defaultMetaAgent === runner.id && enabled && (
                        <span className="agent-default">Default</span>
                      )}
                      {custom && <span className="agent-custom">Manual</span>}
                    </div>
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
                      <p className="task-muted text-xs">
                        Account list unavailable. Open Configure to retry.
                      </p>
                    )}
                    {taskToOpen && (
                      <button
                        className="agent-task-link"
                        type="button"
                        onClick={() => onRun(taskToOpen)}
                      >
                        {waitingRun ? 'Respond to task' : working ? 'View task' : 'Review task'}
                        <ArrowRight size={14} />
                        <span>{taskToOpen.projectName}</span>
                      </button>
                    )}
                  </div>
                  <div className="agent-roster-action">
                    {canStart && (
                      <Button
                        variant="ghost"
                        onClick={() => openAgentConfiguration(runner.id)}
                        aria-label={`Configure ${custom?.name ?? runner.name}`}
                      >
                        <Settings2 size={16} />
                        Configure
                      </Button>
                    )}
                    {canStart ? (
                      <Button
                        variant="outline"
                        aria-label={`New task with ${custom?.name ?? runner.name}`}
                        onClick={() => onNewTask(runner.id)}
                      >
                        New task
                        <ArrowRight size={16} />
                      </Button>
                    ) : runner.id === 'antigravity' &&
                      runner.desktopInstalled &&
                      !runner.available ? (
                      <AgentInstallGuide desktopInstalled compact />
                    ) : (
                      <Button variant="ghost" onClick={() => openAgentConfiguration(runner.id)}>
                        Configure
                        <Settings2 size={16} />
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {runners.some(
          (runner) => runner.id === 'antigravity' && !runner.available && !runner.desktopInstalled,
        ) && (
          <AgentInstallGuide
            desktopInstalled={
              runners.find((runner) => runner.id === 'antigravity')?.desktopInstalled
            }
          />
        )}
        {missing.length > 0 && (
          <p className="task-muted">
            Not detected: {missing.map((runner) => runner.name).join(', ')}. Install and sign in
            through the CLI, then check again.
          </p>
        )}
      </div>
      <Dialog.Root open={adding} onOpenChange={setAdding}>
        <Dialog.Portal>
          <Dialog.Overlay className="task-dialog-overlay" />
          <Dialog.Content {...dialogFocus} className="task-dialog appearance-panel">
            <Dialog.Close className="task-close" aria-label="Close add agent">
              <X size={18} />
            </Dialog.Close>
            <Dialog.Title className="text-2xl font-medium mb-3">Add an agent</Dialog.Title>
            <Dialog.Description className="task-muted mb-6">
              Give your installed agent a name and tell Jackalope where to find it.
            </Dialog.Description>
            <AddAgentForm
              onAdded={() => {
                setAdding(false);
                if (desktop) void checkAgents();
              }}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
