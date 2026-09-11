import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type ScheduleTemplate, scheduleTemplateDraft } from '../../lib/schedule-templates';
import { type ScheduleDefinition as Definition, savedPlanDraft } from '../../lib/schedules';
import { nativeTask, type RunRequest } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import {
  agentAccountFor,
  isAgentAllowedForProject,
  useProjectStore,
} from '../../stores/projectStore';
import { type ScheduledTask, useScheduleStore } from '../../stores/scheduleStore';
import { useTaskStore } from '../../stores/taskStore';
import { TaskKnowledge } from '../knowledge/TaskKnowledge';
import { Button } from '../ui/button';
import { ConfirmAction } from '../ui/ConfirmAction';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';
import { FormField } from '../ui/FormField';
import { InlineNotice } from '../ui/InlineNotice';
import { Input } from '../ui/input';
import { LoadingState } from '../ui/LoadingState';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { Textarea } from '../ui/Textarea';
import { useDialogFocus } from '../ui/useDialogFocus';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import { ScheduleTemplateLibrary } from './ScheduleTemplateLibrary';
import { ScheduleTiming } from './ScheduleTiming';

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
  const [importing, setImporting] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(activeProjectId ?? '');
  const [agent, setAgent] = useState('');
  const [prompt, setPrompt] = useState('');
  const [template, setTemplate] = useState<ScheduleTemplate | null>(null);
  const [templateContext, setTemplateContext] = useState('');
  const [changePreview, setChangePreview] = useState<{ title: string; text: string } | null>(null);
  const focus = useDialogFocus();
  const newSchedule = useRef<HTMLButtonElement>(null);
  const imported = useRef(false);
  const importFocusPending = useRef(false);
  const scheduleOpener = useRef<HTMLElement | null>(null);
  const scheduleFocusPending = useRef(false);
  useEffect(() => {
    if (importFocusPending.current && !busy && !editing) {
      newSchedule.current?.focus();
      importFocusPending.current = false;
    }
    if (scheduleFocusPending.current && !busy && !editing) {
      (scheduleOpener.current?.isConnected ? scheduleOpener.current : newSchedule.current)?.focus();
      scheduleFocusPending.current = false;
    }
  }, [busy, editing]);
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
  const open = (value?: Definition, planId: string | null = null) => {
    scheduleOpener.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTemplate(null);
    setTemplateContext('');
    imported.current = false;
    setImporting(planId);
    const project = projects.find((p) => p.id === (value?.request.projectId ?? activeProjectId));
    setProjectId(project?.id ?? '');
    setAgent(value?.request.agent ?? 'auto');
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
  const chooseTemplate = (selected: ScheduleTemplate) => {
    const target =
      projects.find((item) => item.id === activeProjectId) ??
      (projects.length === 1 ? projects[0] : undefined);
    open(
      scheduleTemplateDraft(selected, {
        id: crypto.randomUUID(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        projectId: target?.id ?? '',
        agent: 'auto',
      }),
    );
    setTemplate(selected);
  };
  const reviewPlan = (plan: ScheduledTask) => {
    try {
      const id = useScheduleStore.getState().prepareImport(plan.id);
      const saved = ledger?.schedules.find((schedule) => schedule.definition.id === id);
      open(saved?.definition ?? savedPlanDraft(plan, id, runners), plan.id);
    } catch (cause) {
      setError(String(cause));
    }
  };
  useEffect(() => {
    if (!props.sourceRunId) return;
    const run = useExecutionStore.getState().runs.find((r) => r.id === props.sourceRunId);
    if (!run) return;
    imported.current = false;
    setTemplate(null);
    setTemplateContext('');
    scheduleOpener.current = null;
    setImporting(null);
    setProjectId(run.projectId);
    setAgent(run.routing ? 'auto' : run.agent);
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
  const rawPrompt = templateContext.trim()
    ? `${prompt.trim()}\n\nProject-specific context\n${templateContext.trim()}`
    : prompt.trim();
  const finalPrompt = instructions
    ? `${rawPrompt}\n\n[Project Guidelines]:\n${instructions}`
    : rawPrompt;
  const save = () =>
    act(async () => {
      if (!editing || !project) return;
      if (!monitorOnly && agent !== 'auto' && !isAgentAllowedForProject(project, agent))
        throw new Error('This agent is not allowed for the selected project.');
      await syncAgentConfig();
      const adapter =
        useAgentConfigStore.getState().customAgents.find((a) => a.id === agent)?.adapter ?? agent;
      await nativeTask('schedule_save', {
        definition: {
          ...editing,
          rawPrompt,
          request: {
            contextSelection: editing.request.contextSelection,
            id: editing.id,
            projectId: project.id,
            projectName: project.name,
            projectPath: project.path,
            agent,
            prompt: finalPrompt,
            isolated: true,
            agentProfileId: agent === 'auto' ? undefined : agentAccountFor(project, adapter),
            targetBranch: project.preferences?.baseBranch || project.gitBranch,
            verifyCommand: project.preferences?.verifyCommand,
            prepareCommand: project.preferences?.prepareCommand,
            autoVerify: project.preferences?.autoVerify === true,
          },
        },
      });
      if (importing) {
        useScheduleStore.getState().deleteSchedule(importing);
        imported.current = true;
        importFocusPending.current = true;
      }
      setEditing(null);
      setImporting(null);
    });
  const visible =
    ledger?.schedules.filter(
      (s) => !activeProjectId || s.definition.request.projectId === activeProjectId,
    ) ?? [];
  return (
    <WorkspacePage className="">
      <WorkspaceHeading
        title="Recurring tasks"
        description="Runs while Jackalope is open, including in the tray."
        action={
          <Button
            ref={newSchedule}
            disabled={!desktop || busy}
            onClick={() => (projects.length ? open() : props.onOpenProject())}
          >
            <Plus size={18} />
            New schedule
          </Button>
        }
      />
      {!desktop && <InlineNotice>Open the desktop app to schedule execution.</InlineNotice>}
      {visible.length > 0 && <WorkspaceSectionHeading title="Your schedules" />}
      {(error || ledger?.error) && (
        <InlineNotice tone="error">{error || ledger?.error}</InlineNotice>
      )}
      {desktop && !ledger && !error && <LoadingState label={'Loading schedules…'} />}
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
              <Disclosure className="mt-3">
                <DisclosureSummary className="min-h-11 py-3">
                  Instructions and run history ({history.length})
                </DisclosureSummary>
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
              </Disclosure>
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
      {visible.length > 0 && (
        <p className="task-muted mt-5">
          Pausing keeps active runs. Overlapping or interrupted runs are skipped; failed starts are
          not retried.
        </p>
      )}
      <ScheduleTemplateLibrary onChoose={chooseTemplate} disabled={!desktop || busy} />
      {legacy.length > 0 && (
        <Disclosure className="mt-6">
          <DisclosureSummary>Recover saved schedule plans ({legacy.length})</DisclosureSummary>
          <p className="task-muted my-3">
            Review and save these plans as schedules. They start paused.
          </p>
          <div className="schedule-list">
            {legacy.map((plan) => (
              <article className="schedule-row" key={plan.id}>
                <h3>{plan.name}</h3>
                <p className="task-muted">
                  {projects.find((item) => item.id === plan.targetProjectId)?.name ??
                    'Choose a replacement project'}{' '}
                  · {plan.cronExpression}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button disabled={!desktop || busy || !ledger} onClick={() => reviewPlan(plan)}>
                    Review plan
                  </Button>
                  <ConfirmAction
                    title="Delete saved plan?"
                    description="This removes the saved instructions and timing. Existing tasks and native schedules are kept."
                    onConfirm={() => useScheduleStore.getState().deleteSchedule(plan.id)}
                    trigger={
                      <Button variant="ghost" disabled={busy}>
                        Delete plan
                      </Button>
                    }
                  />
                </div>
              </article>
            ))}
          </div>
        </Disclosure>
      )}
      <Dialog.Root
        open={!!changePreview}
        onOpenChange={(open) => {
          if (!open) setChangePreview(null);
        }}
      >
        <DialogContent {...focus}>
          <DialogCloseButton label="Close change preview" />
          <DialogHeader
            title={changePreview?.title}
            description={
              <>
                Local content difference captured by this monitor. No agent was used to produce this
                preview.
              </>
            }
          />
          <Textarea
            className="task-output mt-4 w-full"
            aria-label="Recorded content diff"
            readOnly
            rows={14}
            value={changePreview?.text || 'No text diff available.'}
          />
        </DialogContent>
      </Dialog.Root>
      <Dialog.Root
        open={!!editing}
        onOpenChange={(value) => {
          if (!value && !busy) setEditing(null);
        }}
      >
        <DialogContent
          {...focus}
          onCloseAutoFocus={(event) => {
            if (imported.current) {
              event.preventDefault();
              newSchedule.current?.focus();
              imported.current = false;
            } else {
              event.preventDefault();
              if (busy) scheduleFocusPending.current = true;
              else
                (scheduleOpener.current?.isConnected
                  ? scheduleOpener.current
                  : newSchedule.current
                )?.focus();
            }
          }}
          contained
          className="schedule-editor"
        >
          <DialogCloseButton disabled={busy} label="Close schedule" />
          <DialogHeader
            title={template?.name ?? 'Schedule recurring work'}
            description={
              template?.outcome ??
              'Choose instructions, an agent, and a repeat schedule for your project.'
            }
          />
          {editing && (
            <form
              className="schedule-editor-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <div className="schedule-editor-body">
                <div className="schedule-editor-column">
                  <section
                    className="schedule-editor-section"
                    aria-labelledby="schedule-task-heading"
                  >
                    <h3 id="schedule-task-heading">What to do</h3>
                    <div className="schedule-fields">
                      <FormField label="Name">
                        <Input
                          id="schedule-name"
                          required
                          maxLength={160}
                          value={editing.name}
                          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        />
                      </FormField>
                      <FormField label="Project">
                        <Select
                          id="schedule-project"
                          value={projectId}
                          onValueChange={(value) => {
                            setProjectId(value);
                            const nextProject = projects.find((item) => item.id === value);
                            if (agent !== 'auto' && !isAgentAllowedForProject(nextProject, agent))
                              setAgent('auto');
                            setEditing({
                              ...editing,
                              request: {
                                ...editing.request,
                                contextSelection: editing.request.contextSelection
                                  ? { memoryOff: editing.request.contextSelection.memoryOff }
                                  : undefined,
                              },
                            });
                          }}
                          aria-label="Schedule project"
                          placeholder="Choose a project"
                        >
                          {projects.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </Select>
                      </FormField>
                      {!monitorOnly && (
                        <FormField label="Agent">
                          <Select
                            id="schedule-agent"
                            value={agent}
                            onValueChange={setAgent}
                            aria-label="Schedule agent"
                            placeholder="Choose an agent"
                            disabled={monitorOnly}
                          >
                            <SelectItem value="auto">Let Jackalope choose</SelectItem>
                            {runners.map((r) => (
                              <SelectItem
                                key={r.id}
                                value={r.id}
                                disabled={
                                  !r.available ||
                                  !project ||
                                  !isAgentAllowedForProject(project, r.id)
                                }
                              >
                                {r.name}
                              </SelectItem>
                            ))}
                          </Select>
                        </FormField>
                      )}
                    </div>
                    {!monitorOnly && (
                      <>
                        <FormField label="Instructions">
                          <Textarea
                            id="schedule-instructions"
                            required={!monitorOnly}
                            disabled={monitorOnly}
                            maxLength={24000}
                            rows={10}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                          />
                        </FormField>
                        {template && (
                          <FormField label="Project context (optional)">
                            <Textarea
                              id="schedule-template-context"
                              rows={2}
                              maxLength={4000}
                              value={templateContext}
                              onChange={(event) => setTemplateContext(event.target.value)}
                              placeholder={template.contextHint}
                            />
                          </FormField>
                        )}
                      </>
                    )}
                    {monitorOnly && (
                      <p className="task-muted">
                        Watch committed changes on your local branch and receive a notification. No
                        agent task runs.
                      </p>
                    )}
                  </section>
                  {project && !monitorOnly && (
                    <TaskKnowledge
                      embedded
                      key={project.id}
                      projectId={project.id}
                      projectPath={project.path}
                      prompt={finalPrompt}
                      selection={editing.request.contextSelection}
                      onChange={(contextSelection) =>
                        setEditing({
                          ...editing,
                          request: { ...editing.request, contextSelection },
                        })
                      }
                    />
                  )}
                </div>
                <div className="schedule-editor-column">
                  <section
                    className="schedule-editor-section"
                    aria-labelledby="schedule-when-heading"
                  >
                    <h3 id="schedule-when-heading">When to run</h3>
                    <ScheduleTiming
                      key={editing.id}
                      expression={editing.expression}
                      onChange={(expression) => setEditing({ ...editing, expression })}
                    />
                    <FormField label="Timezone">
                      <Input
                        id="schedule-timezone"
                        required
                        value={editing.timezone}
                        onChange={(e) => setEditing({ ...editing, timezone: e.target.value })}
                        placeholder="America/Denver"
                      />
                    </FormField>
                    <FormField label="After missed runs">
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
                    </FormField>
                  </section>
                  <section
                    className="schedule-editor-section"
                    aria-labelledby="schedule-behavior-heading"
                  >
                    <h3 id="schedule-behavior-heading">Run behavior</h3>
                    <fieldset className="schedule-run-policy" aria-label="Run policy">
                      {[
                        { value: 'always', label: 'Run an agent every time' },
                        { value: 'run', label: 'Run only after code changes' },
                        { value: 'notify', label: 'Notify about changes without an agent' },
                      ].map(({ value, label }) => (
                        <label key={value}>
                          <input
                            type="radio"
                            name="schedule-policy"
                            value={value}
                            checked={(editing.monitor?.action ?? 'always') === value}
                            onChange={() =>
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
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </fieldset>
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
                          Checks committed content on the saved local target branch, without
                          fetching. The first check records a baseline. Uncommitted edits are
                          excluded.
                        </span>
                      </label>
                    )}
                    <p className="task-muted">
                      Target:{' '}
                      {project?.preferences?.baseBranch || project?.gitBranch || 'Choose a project'}
                      .{' '}
                      {!monitorOnly &&
                        "Account and verification use the selected project's preferences when saved."}
                    </p>
                  </section>
                </div>
              </div>
              <div className="schedule-editor-footer">
                {error && <InlineNotice tone="error">{error}</InlineNotice>}
                {!projects.length && (
                  <InlineNotice>
                    Add a project in Projects, then return to configure this schedule.
                  </InlineNotice>
                )}
                <div className="schedule-editor-actions">
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
                  <Button
                    type="submit"
                    disabled={
                      busy ||
                      !project ||
                      (!monitorOnly &&
                        (!agent || (agent !== 'auto' && !isAgentAllowedForProject(project, agent))))
                    }
                    loading={busy}
                    loadingLabel={'Saving…'}
                  >
                    {'Save schedule'}
                  </Button>
                </div>
                <p className="task-muted text-xs">
                  {monitorOnly
                    ? 'Local checks use no agent.'
                    : 'Enabled runs use these instructions, saved context, and project connections. Changes need review.'}{' '}
                  Leave off to save paused. Keep Jackalope open and this computer awake.
                </p>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog.Root>
    </WorkspacePage>
  );
}
