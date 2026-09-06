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
import { Button } from '../ui/button';
import { ConfirmAction } from '../ui/ConfirmAction';
import { Input } from '../ui/input';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { useDialogFocus } from '../ui/useDialogFocus';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { SchedulePlans } from './SchedulePlans';

interface Definition {
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
  definition: Definition;
  nextAt: string;
  history: { dueAt: string; runId: string | null; outcome: string }[];
}
interface Ledger {
  schedules: SavedSchedule[];
  error: string | null;
}

export function ScheduleManager(props: { onOpenProject: () => void; onPlanning: () => void }) {
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
  const project = projects.find((p) => p.id === projectId);
  const save = () =>
    act(async () => {
      if (!editing || !project) return;
      if (!isAgentAllowedForProject(project, agent))
        throw new Error('This agent is not allowed for the selected project.');
      await syncAgentConfig();
      const adapter =
        useAgentConfigStore.getState().customAgents.find((a) => a.id === agent)?.adapter ?? agent;
      const instructions = project.preferences?.customInstructions?.trim();
      const finalPrompt = instructions
        ? `${prompt.trim()}\n\n[Project Guidelines]:\n${instructions}`
        : prompt.trim();
      await nativeTask('schedule_save', {
        definition: {
          ...editing,
          rawPrompt: prompt.trim(),
          request: {
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
        description="Run saved instructions on this computer while Jackalope is open, including in the system tray."
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
        {visible.map(({ definition: d, nextAt, history }) => (
          <article className="schedule-row" key={d.id}>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-medium">{d.name}</h2>
              <p className="task-muted">
                {d.request.projectName} · {d.request.agent} · {d.timezone}
              </p>
              <p className="task-muted">
                {d.enabled ? `Next: ${new Date(nextAt).toLocaleString()}` : 'Paused'} ·{' '}
                {d.expression}
              </p>
              <details className="mt-3">
                <summary>Instructions and run history ({history.length})</summary>
                <p className="whitespace-pre-wrap my-3">{d.request.prompt}</p>
                {[...history].reverse().map((event) => {
                  const run = runs.find((r) => r.id === event.runId);
                  return (
                    <div key={event.dueAt} className="flex flex-wrap items-center gap-3 py-2">
                      <span>
                        {new Date(event.dueAt).toLocaleString()} · {run?.status ?? event.outcome}
                      </span>
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
              Enabling authorizes automatic agent execution with these saved instructions. Runs use
              isolated worktrees and require review before integration. The timezone follows
              daylight saving time.
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
                <label className="block" htmlFor="schedule-agent">
                  Agent
                  <Select
                    id="schedule-agent"
                    value={agent}
                    onValueChange={setAgent}
                    aria-label="Schedule agent"
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
                <label className="block" htmlFor="schedule-instructions">
                  Instructions
                  <textarea
                    id="schedule-instructions"
                    className="task-input w-full"
                    required
                    maxLength={24000}
                    rows={4}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                </label>
                <p className="task-muted">
                  Target:{' '}
                  {project?.preferences?.baseBranch || project?.gitBranch || 'Choose a project'}.
                  Account and verification use the selected project's preferences when saved.
                </p>
                <div className="flex items-center gap-3">
                  <Switch
                    id="schedule-enabled"
                    label="Enable automatic runs"
                    checked={editing.enabled}
                    onCheckedChange={(enabled) => setEditing({ ...editing, enabled })}
                  />
                  <label htmlFor="schedule-enabled">Enable automatic runs</label>
                </div>
                <p className="task-muted">
                  Leave this off to save a paused schedule. Enabled project connections are
                  available to each run.
                </p>
                {error && (
                  <p role="alert" className="task-error">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={busy || !project || !agent}>
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
