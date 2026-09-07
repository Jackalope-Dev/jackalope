import * as Dialog from '@radix-ui/react-dialog';
import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { nativeTask, type RunRequest } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import {
  agentAccountFor,
  isAgentAllowedForProject,
  useProjectStore,
} from '../../stores/projectStore';
import { useScheduleStore } from '../../stores/scheduleStore';
import { useTaskStore } from '../../stores/taskStore';
import { TaskKnowledge } from '../knowledge/TaskKnowledge';
import { Button } from '../ui/button';
import { ConfirmAction } from '../ui/ConfirmAction';
import { Input } from '../ui/input';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { useDialogFocus } from '../ui/useDialogFocus';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { SchedulePlans } from './SchedulePlans';

interface Definition {
  monitor?: { path: string; action: 'notify' | 'run' } | null;
  id: string;
  name: string;
  expression: string;
  timezone: string;
  rawPrompt?: string;
  missed: 'skip' | 'once';
  enabled: boolean;
  request: RunRequest;
}
interface SavedSchedule {
  localChecks?: number;
  quietChecks?: number;
  definition: Definition;
  nextAt: string;
  history: {
    dueAt: string;
    runId: string | null;
    outcome: string;
    change?: { before: string; after: string; path: string; branch: string } | null;
  }[];
}
interface Ledger {
  schedules: SavedSchedule[];
  error: string | null;
}

export function ScheduleManager(props: {
  onOpenProject: () => void;
  onPlanning: () => void;
  sourceRunId?: string;
  onSourceHandled?: () => void;
}) {
  const { projects, activeProjectId, selectProject } = useProjectStore();
  const runners = useExecutionStore((s) => s.runners);
  const runs = useExecutionStore((s) => s.runs);
  const legacy = useScheduleStore((s) => s.schedules);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Definition | null>(null);
  const [projectId, setProjectId] = useState(activeProjectId ?? '');
  const [agent, setAgent] = useState('');
  const [prompt, setPrompt] = useState('');
  const [changePreview, setChangePreview] = useState<{ title: string; text: string } | null>(null);
  const focus = useDialogFocus();
  const desktop = isTauriEnvironment();
  const refresh = async () => setLedger(await nativeTask<Ledger>('schedule_list'));
  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    const read = () =>
      nativeTask<Ledger>('schedule_list')
        .then((data) => {
          if (alive) setLedger(data);
        })
        .catch((cause) => {
          if (alive) setError(String(cause));
        });
    void read();
    const timer = window.setInterval(read, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [desktop]);
  const act = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const open = (value?: Definition) => {
    const project = projects.find((p) => p.id === (value?.request.projectId ?? activeProjectId));
    setProjectId(project?.id ?? '');
    setAgent(value?.request.agent ?? '');
    setPrompt(value?.rawPrompt ?? value?.request.prompt ?? '');
    setEditing(
      value ?? {
        id: crypto.randomUUID(),
        name: '',
        expression: '0 9 * * 1-5',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        missed: 'skip',
        enabled: false,
        request: {} as RunRequest,
      },
    );
  };
  useEffect(() => {
    if (!props.sourceRunId) return;
    const run = useExecutionStore.getState().runs.find((r) => r.id === props.sourceRunId);
    if (!run) return;
    setProjectId(run.projectId);
    setAgent(run.agent);
    const original = useTaskStore
      .getState()
      .tasks.find(
        (idea) =>
          idea.runId === run.id || runs.some((r) => r.taskId === run.taskId && r.id === idea.runId),
      );
    setPrompt(original?.rawPrompt ?? run.prompt);
    setEditing({
      id: crypto.randomUUID(),
      name: original?.title ?? 'Repeat this task',
      expression: '0 9 * * 1-5',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      missed: 'skip',
      enabled: false,
      request: {} as RunRequest,
    });
    props.onSourceHandled?.();
  }, [props.sourceRunId, props.onSourceHandled, runs]);
  const project = projects.find((p) => p.id === projectId);
  const monitorOnly = editing?.monitor?.action === 'notify';
  const instructions = project?.preferences?.customInstructions?.trim();
  const finalPrompt = instructions
    ? `${prompt.trim()}\n\n[Project Guidelines]:\n${instructions}`
    : prompt.trim();
  const save = () =>
    act(async () => {
      if (!editing || !project) return;
      if (!monitorOnly && !isAgentAllowedForProject(project, agent))
        throw new Error('This agent is not allowed for the selected project.');
      await syncAgentConfig();
      const adapter =
        useAgentConfigStore.getState().customAgents.find((a) => a.id === agent)?.adapter ?? agent;
      await nativeTask('schedule_save', {
        definition: {
          ...editing,
          rawPrompt: prompt.trim(),
          request: {
            contextSelection: editing.request.contextSelection,
            id: editing.id,
            projectId: project.id,
            projectName: project.name,
            projectPath: project.path,
            agent,
            prompt: finalPrompt,
            isolated: true,
            agentProfileId: agentAccountFor(project, adapter),
            targetBranch: project.preferences?.baseBranch || project.gitBranch,
            verifyCommand: project.preferences?.verifyCommand,
            prepareCommand: project.preferences?.prepareCommand,
            autoVerify: project.preferences?.autoVerify === true,
          },
        },
      });
      setEditing(null);
    });
  const visible =
    ledger?.schedules.filter(
      (s) => !activeProjectId || s.definition.request.projectId === activeProjectId,
    ) ?? [];
  return (
    <section className="task-page">
      <WorkspaceHeading
        title="Recurring tasks"
        description="Schedule agent work or watch code changes locally while Jackalope is open, including in the system tray."
        action={
          <Button
            disabled={!desktop || busy}
            onClick={() => (projects.length ? open() : props.onOpenProject())}
          >
            <Plus size={18} />
            New schedule
          </Button>
        }
      />
      {!desktop && <p className="task-notice">Open the desktop app to schedule execution.</p>}
      {(error || ledger?.error) && (
        <p role="alert" className="task-error">
          {error || ledger?.error}
        </p>
      )}
      {desktop && !ledger && !error && <p role="status">Loading schedules…</p>}
      {ledger && !visible.length && (
        <p className="task-muted">
          No schedules for this project. Choose New schedule to save instructions and timing.
        </p>
      )}
      <div className="schedule-list">
        {visible.map(({ definition: d, nextAt, history, localChecks, quietChecks }) => (
          <article className="schedule-row" key={d.id}>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-medium">{d.name}</h2>
              <p className="task-muted">
                {d.request.projectName} ·{' '}
                {d.monitor?.action === 'notify' ? 'Local monitor' : d.request.agent} · {d.timezone}
              </p>
              <p className="task-muted">
                {d.enabled ? `Next: ${new Date(nextAt).toLocaleString()}` : 'Paused'} ·{' '}
                {d.expression}
              </p>
              {d.monitor && (
                <div className="task-muted mt-2">
                  <p>
                    Watching {d.monitor.path || 'all tracked files'} on {d.request.targetBranch}.{' '}
                    {d.monitor.action === 'notify'
                      ? 'Notify on change; no agent used.'
                      : 'Run agent only when committed content changes.'}
                  </p>
                  <p>
                    {localChecks ?? 0} local checks · {quietChecks ?? 0} quiet checks. Checks use
                    zero model tokens.
                  </p>
                </div>
              )}
              <details className="mt-3">
                <summary className="min-h-11 py-3">
                  Instructions and run history ({history.length})
                </summary>
                <p className="whitespace-pre-wrap my-3">{d.request.prompt}</p>
                {[...history].reverse().map((event) => {
                  const run = runs.find((r) => r.id === event.runId);
                  return (
                    <div key={event.dueAt} className="flex flex-wrap items-center gap-3 py-2">
                      <span>
                        {new Date(event.dueAt).toLocaleString()} · {run?.status ?? event.outcome}
                      </span>
                      {event.change && (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              const text = await nativeTask<string>('schedule_inspect_change', {
                                id: d.id,
                                dueAt: event.dueAt,
                              });
                              setChangePreview({
                                title: `${d.name} · ${new Date(event.dueAt).toLocaleString()}`,
                                text,
                              });
                            })
                          }
                        >
                          Inspect change
                        </Button>
                      )}
                      {run && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            selectProject(run.projectId);
                            props.onPlanning();
                            useExecutionStore.getState().select(run.id);
                          }}
                        >
                          View run
                        </Button>
                      )}
                      {run && ['starting', 'running'].includes(run.status) && (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void act(() => nativeTask('task_stop', { id: run.id }))}
                        >
                          Stop run
                        </Button>
                      )}
                    </div>
                  );
                })}
                {!history.length && <p className="task-muted">No occurrences yet.</p>}
              </details>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => open(d)}>
                Edit
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    nativeTask('schedule_set_enabled', { id: d.id, enabled: !d.enabled }),
                  )
                }
              >
                {d.enabled ? 'Pause' : 'Enable'}
              </Button>
              <ConfirmAction
                title="Delete schedule?"
                description="Future occurrences stop. Existing tasks and worktrees are kept."
                onConfirm={() => act(() => nativeTask('schedule_remove', { id: d.id }))}
                trigger={
                  <Button variant="ghost" disabled={busy}>
                    Delete
                  </Button>
                }
              />
            </div>
          </article>
        ))}
      </div>
      <p className="task-muted mt-5">
        Overlapping or interrupted runs are skipped. Pausing keeps existing work; use Stop run to
        cancel execution. Failed starts are recorded without automatic retries.
      </p>
      {legacy.length > 0 && (
        <details className="mt-6">
          <summary>Saved plans from earlier versions ({legacy.length})</summary>
          <SchedulePlans {...props} />
        </details>
      )}
      <Dialog.Root
        open={!!changePreview}
        onOpenChange={(open) => {
          if (!open) setChangePreview(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="task-dialog-overlay" />
          <Dialog.Content {...focus} className="task-dialog appearance-panel">
            <Dialog.Close className="task-close" aria-label="Close change preview">
              <X size={18} />
            </Dialog.Close>
            <Dialog.Title className="text-xl">{changePreview?.title}</Dialog.Title>
            <Dialog.Description className="task-muted mt-3">
              Local content difference captured by this monitor. No agent was used to produce this
              preview.
            </Dialog.Description>
            <textarea
              className="task-output mt-4 w-full"
              aria-label="Recorded content diff"
              readOnly
              rows={14}
              value={changePreview?.text || 'No text diff available.'}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={!!editing}
        onOpenChange={(value) => {
          if (!value && !busy) setEditing(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="task-dialog-overlay" />
          <Dialog.Content {...focus} className="task-dialog appearance-panel">
            <Dialog.Close className="task-close" disabled={busy} aria-label="Close schedule">
              <X size={18} />
            </Dialog.Close>
            <Dialog.Title className="text-xl">Schedule recurring work</Dialog.Title>
            <Dialog.Description className="task-muted mt-3">
              Choose a local change monitor or an agent schedule. Agent runs use isolated worktrees
              and require review before integration. Jackalope must be open and this computer awake.
            </Dialog.Description>
            {editing && (
              <form
                className="space-y-4 mt-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <label className="block" htmlFor="schedule-name">
                  Name
                  <Input
                    id="schedule-name"
                    required
                    maxLength={160}
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                </label>
                <label className="block" htmlFor="schedule-project">
                  Project
                  <Select
                    id="schedule-project"
                    value={projectId}
                    onValueChange={setProjectId}
                    aria-label="Schedule project"
                  >
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </Select>
                </label>
                <label className="block" htmlFor="schedule-mode">
                  Run policy
                  <Select
                    id="schedule-mode"
                    aria-label="Run policy"
                    value={editing.monitor?.action ?? 'always'}
                    onValueChange={(value) =>
                      setEditing({
                        ...editing,
                        monitor:
                          value === 'always'
                            ? null
                            : {
                                path: editing.monitor?.path ?? '',
                                action: value as 'notify' | 'run',
                              },
                      })
                    }
                  >
                    <SelectItem value="always">Run an agent every time</SelectItem>
                    <SelectItem value="run">Run an agent only after code changes</SelectItem>
                    <SelectItem value="notify">Notify about code changes · no agent</SelectItem>
                  </Select>
                </label>
                <label className="block" htmlFor="schedule-preset">
                  Repeat
                  <Select
                    id="schedule-preset"
                    aria-label="Repeat schedule"
                    value={
                      ['0 9 * * 1-5', '0 9 * * 1', '0 9 * * *'].includes(editing.expression)
                        ? editing.expression
                        : 'custom'
                    }
                    onValueChange={(expression) => {
                      if (expression !== 'custom') setEditing({ ...editing, expression });
                    }}
                  >
                    <SelectItem value="0 9 * * 1-5">Weekdays at 9:00</SelectItem>
                    <SelectItem value="0 9 * * 1">Mondays at 9:00</SelectItem>
                    <SelectItem value="0 9 * * *">Every day at 9:00</SelectItem>
                    <SelectItem value="custom">Custom timing below</SelectItem>
                  </Select>
                </label>
                {editing.monitor && (
                  <label className="block" htmlFor="schedule-watch-path">
                    Tracked path to watch (optional)
                    <Input
                      id="schedule-watch-path"
                      maxLength={500}
                      value={editing.monitor.path}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          monitor: {
                            action: editing.monitor?.action ?? 'notify',
                            path: e.target.value,
                          },
                        })
                      }
                      placeholder="src or package.json; blank watches the whole branch"
                    />
                    <span className="task-muted">
                      Checks committed content on the saved local target branch, without fetching.
                      The first check records a baseline. Uncommitted edits are excluded.
                    </span>
                  </label>
                )}
                {!monitorOnly && (
                  <label className="block" htmlFor="schedule-agent">
                    Agent
                    <Select
                      id="schedule-agent"
                      value={agent}
                      onValueChange={setAgent}
                      aria-label="Schedule agent"
                      disabled={monitorOnly}
                    >
                      {runners.map((r) => (
                        <SelectItem
                          key={r.id}
                          value={r.id}
                          disabled={
                            !r.available || !project || !isAgentAllowedForProject(project, r.id)
                          }
                        >
                          {r.name}
                        </SelectItem>
                      ))}
                    </Select>
                  </label>
                )}
                <label className="block" htmlFor="schedule-timing">
                  Timing
                  <Input
                    id="schedule-timing"
                    required
                    value={editing.expression}
                    onChange={(e) => setEditing({ ...editing, expression: e.target.value })}
                  />
                  <span className="task-muted">
                    Minute, hour, day, month, weekday. Weekdays at 9:00: 0 9 * * 1-5.
                  </span>
                </label>
                <label className="block" htmlFor="schedule-timezone">
                  Timezone
                  <Input
                    id="schedule-timezone"
                    required
                    value={editing.timezone}
                    onChange={(e) => setEditing({ ...editing, timezone: e.target.value })}
                    placeholder="America/Denver"
                  />
                </label>
                <label className="block" htmlFor="schedule-missed">
                  After missed runs
                  <Select
                    id="schedule-missed"
                    value={editing.missed}
                    onValueChange={(missed) =>
                      setEditing({ ...editing, missed: missed as 'skip' | 'once' })
                    }
                    aria-label="Missed runs"
                  >
                    <SelectItem value="skip">Skip to the next occurrence</SelectItem>
                    <SelectItem value="once">Catch up once when available</SelectItem>
                  </Select>
                </label>
                {!monitorOnly && (
                  <label className="block" htmlFor="schedule-instructions">
                    Instructions
                    <textarea
                      id="schedule-instructions"
                      className="task-input w-full"
                      required={!monitorOnly}
                      disabled={monitorOnly}
                      maxLength={24000}
                      rows={4}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                    />
                  </label>
                )}
                {project && !monitorOnly && (
                  <TaskKnowledge
                    key={project.id}
                    projectId={project.id}
                    projectPath={project.path}
                    prompt={finalPrompt}
                    selection={editing.request.contextSelection}
                    onChange={(contextSelection) =>
                      setEditing({ ...editing, request: { ...editing.request, contextSelection } })
                    }
                  />
                )}
                <p className="task-muted">
                  Target:{' '}
                  {project?.preferences?.baseBranch || project?.gitBranch || 'Choose a project'}.
                  {!monitorOnly &&
                    "Account and verification use the selected project's preferences when saved."}
                </p>
                <div className="flex items-center gap-3">
                  <Switch
                    id="schedule-enabled"
                    label={monitorOnly ? 'Enable local checks' : 'Enable automatic runs'}
                    checked={editing.enabled}
                    onCheckedChange={(enabled) => setEditing({ ...editing, enabled })}
                  />
                  <label htmlFor="schedule-enabled">
                    {monitorOnly ? 'Enable local checks' : 'Enable automatic runs'}
                  </label>
                </div>
                <p className="task-muted">
                  {monitorOnly
                    ? 'Enable to check locally and notify on changes, with zero model tokens.'
                    : 'Enable to authorize agent runs with these instructions and selected workflow. Matching saved project lessons and enabled connections are available to each run.'}{' '}
                  Leave off to save paused.
                </p>
                {error && (
                  <p role="alert" className="task-error">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={busy || !project || (!monitorOnly && !agent)}>
                  {busy ? 'Saving…' : 'Save schedule'}
                </Button>
              </form>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
