import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
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
import { Button } from '../ui/button';
import { ConfirmAction } from '../ui/ConfirmAction';
import { InlineNotice } from '../ui/InlineNotice';
import { LoadingState } from '../ui/LoadingState';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import { ScheduleChangePreviewDialog } from './ScheduleChangePreviewDialog';
import { ScheduleEditDialog } from './ScheduleEditDialog';
import { ScheduleTemplateLibrary } from './ScheduleTemplateLibrary';
import { ScheduleWebhookDialog } from './ScheduleWebhookDialog';

interface SavedSchedule {
  localChecks?: number;
  quietChecks?: number;
  webhook?: { createdAt: string } | null;
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
  const { projects, activeProjectId, selectProject } = useProjectStore(
    useShallow((s) => ({
      projects: s.projects,
      activeProjectId: s.activeProjectId,
      selectProject: s.selectProject,
    })),
  );
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
  const [webhook, setWebhook] = useState<{
    id: string;
    name: string;
    active: boolean;
    url?: string;
    token?: string;
  } | null>(null);
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
            setupFiles: project.preferences?.setupFiles,
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
        {visible.map(
          ({ definition: d, nextAt, history, localChecks, quietChecks, webhook: hook }) => (
            <article className="schedule-row" key={d.id}>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-medium">{d.name}</h2>
                <p className="task-muted">
                  {d.request.projectName} ·{' '}
                  {d.monitor?.action === 'notify' ? 'Local monitor' : d.request.agent} ·{' '}
                  {d.timezone}
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
                      {localChecks ?? 0} local checks · {quietChecks ?? 0} quiet checks
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
                  variant="outline"
                  disabled={busy || !desktop}
                  onClick={() =>
                    setWebhook({
                      id: d.id,
                      name: d.name,
                      active: Boolean(hook),
                    })
                  }
                >
                  Webhook
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
          ),
        )}
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
      <ScheduleChangePreviewDialog preview={changePreview} onClose={() => setChangePreview(null)} />
      <ScheduleWebhookDialog
        webhook={webhook}
        busy={busy}
        error={error}
        onClose={() => setWebhook(null)}
        onEnable={async () => {
          if (!webhook) return;
          await act(async () => {
            const revealed = await nativeTask<{ url: string; token: string }>(
              'schedule_webhook_enable',
              { id: webhook.id },
            );
            setWebhook({
              ...webhook,
              active: true,
              url: revealed.url,
              token: revealed.token,
            });
            setLedger(await nativeTask<Ledger>('schedule_list'));
          });
        }}
        onDisable={async () => {
          if (!webhook) return;
          await act(async () => {
            await nativeTask('schedule_webhook_disable', { id: webhook.id });
            setWebhook(null);
            setLedger(await nativeTask<Ledger>('schedule_list'));
          });
        }}
      />
      <ScheduleEditDialog
        editing={editing}
        template={template}
        projects={projects}
        projectId={projectId}
        onProjectIdChange={setProjectId}
        agent={agent}
        onAgentChange={setAgent}
        prompt={prompt}
        onPromptChange={setPrompt}
        templateContext={templateContext}
        onTemplateContextChange={setTemplateContext}
        finalPrompt={finalPrompt}
        runners={runners}
        busy={busy}
        error={error}
        onClose={() => setEditing(null)}
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
        onSave={save}
        onEditingChange={setEditing}
      />
    </WorkspacePage>
  );
}
