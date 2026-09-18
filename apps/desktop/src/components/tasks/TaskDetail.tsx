import {
  Checkbox,
  DefinitionList,
  Disclosure,
  DisclosureSummary,
  DropdownMenu as Menu,
  Textarea,
} from '@jackalope/ui';
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  Copy,
  GitMerge,
  MoreHorizontal,
  Play,
  Square,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { waitForStoppedAttempt } from '../../lib/continue-task';
import { recoveryHandoff } from '../../lib/project-return';
import { appendFeedbackDraft } from '../../lib/review-feedback';
import type { TaskFollowUp } from '../../lib/task-followups';
import {
  canRetry,
  isActive,
  nativeTask,
  retryTask,
  statusLabel,
  type TaskRun,
} from '../../lib/task-runtime';
import { taskTitle } from '../../lib/task-title';
import { latestAttempt, taskDecision } from '../../lib/task-workflow';
import { isTauriEnvironment, listMcpServers, type McpServerConfig } from '../../lib/tauri-bridge';
import { describeRunUsage } from '../../lib/usage-insights';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { useWorkbenchStore } from '../../stores/workbenchStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { TaskLearning } from '../knowledge/TaskLearning';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceTabs as Tabs } from '../ui/WorkspaceTabs';
import { FeedbackTouchpoint } from './FeedbackTouchpoint';
import { ResultReview, type ReviewSection } from './ResultReview';
import { ScreenshotPreview } from './ScreenshotPreview';
import { TaskActivity } from './TaskActivity';
import { TaskDelivery } from './TaskDelivery';
import { TaskFailure } from './TaskFailure';
import { TaskIntegration } from './TaskIntegration';
import { TaskOutcomes } from './TaskOutcomes';
import { TaskPreview } from './TaskPreview';
import { TaskProgress } from './TaskProgress';
import { TaskSaveRecovery } from './TaskSaveRecovery';
import { TaskTiming } from './TaskTiming';
import { UserPromptCard } from './UserPromptCard';
import { useManagedPreview } from './useManagedPreview';
import { ValidationJourney } from './ValidationJourney';
import { WorkContext } from './WorkContext';
import { WorkFeedbackInbox } from './WorkFeedbackInbox';
import { WorkSourceLink } from './WorkSourceLink';
import { WorkspaceReadiness } from './WorkspaceReadiness';
import './task-detail.css';

const TaskMarkdown = lazy(() => import('./TaskMarkdown'));
// The tools panel pulls in the agent, connection and project editors; load it
// only when the user opens it.
const TaskTools = lazy(() => import('./TaskTools').then((m) => ({ default: m.TaskTools })));

export function TaskDetail({
  run,
  onBack,
  onSchedule,
  onCapture,
  integrated: alreadyIntegrated = false,
}: {
  integrated?: boolean;
  run: TaskRun;
  onBack: () => void;
  onSchedule: () => void;
  onCapture: (ideaId?: string) => void;
}) {
  const { runs, start, submitting, refresh, drafts, draft } = useExecutionStore();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!run.detailsOmitted) heading.current?.focus();
  }, [run.detailsOmitted]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [acting, setActing] = useState(false);
  const [followups, setFollowups] = useState<TaskFollowUp[]>([]);
  const [queueError, setQueueError] = useState('');
  const queueRequest = useRef<{ key: string; id: string } | null>(null);
  const queuedHere = useRef(false);
  const [queueing, setQueueing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const workRequest = useWorkViewStore((state) => state.request);
  const savedTab = useWorkViewStore.getState().reading[run.taskId];
  const [tab, setTab] = useState(
    savedTab === 'context'
      ? 'activity'
      : savedTab === 'delivery'
        ? 'changes'
        : (savedTab ?? 'result'),
  );
  const [detailsOpen, setDetailsOpen] = useState(savedTab === 'context');
  const [reviewSection, setReviewSection] = useState<ReviewSection>(
    savedTab === 'delivery' ? 'delivery' : 'changes',
  );
  useEffect(() => {
    useWorkViewStore.getState().remember(run.taskId, tab);
  }, [run.taskId, tab]);
  useEffect(() => {
    if (workRequest?.id !== run.id) return;
    const section = workRequest.section;
    if (section === 'terminal') return;
    if (section === 'question' || section === 'recovery') {
      document
        .getElementById(section === 'question' ? 'task-questions' : 'task-recovery')
        ?.querySelector<HTMLElement>('button, input, textarea')
        ?.focus();
    } else {
      setTab(
        ['verify', 'integrate', 'delivery'].includes(section)
          ? 'changes'
          : section === 'context'
            ? 'activity'
            : section,
      );
      if (section === 'context') setDetailsOpen(true);
      if (section === 'delivery') setReviewSection('delivery');
      if (section === 'verify') setReviewSection('checks');
      if (section === 'integrate') {
        setIntegrating(true);
        setReviewSection('delivery');
        requestAnimationFrame(() =>
          document.getElementById('task-merge')?.scrollIntoView({ block: 'start' }),
        );
      }
    }
  }, [workRequest, run.id]);
  const [integrating, setIntegrating] = useState(false);
  const [appliedHere, setIntegrated] = useState(false);
  const integrated = alreadyIntegrated || appliedHere;
  const [imageAttempt, setImageAttempt] = useState(0);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [connections, setConnections] = useState<McpServerConfig[] | null>(null);
  const applied = useCallback(() => setIntegrated(true), []);
  const key = `reply:${run.taskId}`;
  const preset = useWorkbenchStore((state) => state.presets[run.projectId] ?? 'focus');
  const split = useWorkViewStore((state) => state.split[run.taskId] ?? preset === 'build');
  const alongside = split && ['changes', 'preview'].includes(tab);
  const reply = drafts[key]?.prompt ?? '';
  const active = isActive(run);
  const previewRunning = useManagedPreview(run.id, !active && !integrated);
  const routing = run.routing;
  const attempts = runs
    .filter((r) => r.taskId === run.taskId)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const latest = latestAttempt(runs, run.taskId);
  const isLatest = latest?.id === run.id;
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let alive = true;
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const value = await nativeTask<TaskFollowUp[]>('task_followup_snapshot', {
          taskId: run.taskId,
        });
        if (alive) {
          setFollowups(value ?? []);
          setQueueError('');
          if (queuedHere.current && !value?.length) {
            await refresh();
            const state = useExecutionStore.getState();
            const next = latestAttempt(state.runs, run.taskId);
            if (
              alive &&
              queuedHere.current &&
              next &&
              next.id !== run.id &&
              state.selectedId === run.id
            ) {
              queuedHere.current = false;
              state.select(next.id);
            }
          }
        }
      } catch (cause) {
        if (alive) setQueueError(String(cause));
      } finally {
        pending = false;
      }
    };
    void load();
    const interval = setInterval(() => void load(), 1000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [run.id, run.taskId, refresh]);
  const sourceIdea = useTaskStore((state) =>
    state.tasks.find(
      (idea) =>
        idea.projectId === run.projectId && attempts.some((attempt) => attempt.id === idea.runId),
    ),
  );
  const currentProject = useProjectStore((s) => s.projects.find((p) => p.id === run.projectId));
  const title = taskTitle(
    sourceIdea?.rawPrompt ?? attempts[0]?.prompt ?? run.prompt,
    sourceIdea?.title,
  );
  const pending = run.prompts?.filter((p) => p.status === 'pending') ?? [];
  const isolated =
    !!run.workspace &&
    run.workspace.replaceAll('\\', '/').toLowerCase() !==
      run.projectPath.replaceAll('\\', '/').toLowerCase();
  const finished = !active && ['review', 'reviewed'].includes(run.status);
  const canContinue = isLatest && !!run.sessionId && run.status !== 'interrupted' && !integrated;
  const decision = taskDecision(run, integrated, currentProject?.preferences?.verifyCommand);
  const inspect = (section: string) => {
    if (section === 'question' || section === 'recovery') {
      document
        .getElementById(section === 'question' ? 'task-questions' : 'task-recovery')
        ?.scrollIntoView({ block: 'center' });
      document
        .getElementById(section === 'question' ? 'task-questions' : 'task-recovery')
        ?.querySelector<HTMLElement>('button, input, textarea')
        ?.focus();
    } else {
      setTab(['integrate', 'verify', 'delivery'].includes(section) ? 'changes' : section);
      if (section === 'verify') setReviewSection('checks');
      if (section === 'delivery') setReviewSection('delivery');
      if (section === 'integrate') {
        setIntegrating(true);
        setReviewSection('delivery');
        requestAnimationFrame(() =>
          document.getElementById('task-merge')?.scrollIntoView({ block: 'start' }),
        );
      }
    }
  };
  const primaryAction = async () => {
    inspect(decision.section);
    if (decision.section !== 'verify' || acting) return;
    const command = run.verifyCommand || currentProject?.preferences?.verifyCommand;
    if (!command) return;
    setActing(true);
    setError('');
    try {
      await nativeTask('task_verify', { id: run.id, command });
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setActing(false);
    }
  };

  useEffect(() => {
    if (tab !== 'context' || !isLatest || connections !== null) return;
    let alive = true;
    void listMcpServers(run.projectId)
      .then((servers) => {
        if (alive)
          setConnections(
            servers.filter(
              (server) => server.enabled !== false && server.scope === `project:${run.projectId}`,
            ),
          );
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      });
    return () => {
      alive = false;
    };
  }, [tab, isLatest, connections, run.projectId]);
  const act = async (command: string) => {
    if (acting) return;
    setActing(true);
    setError('');
    try {
      await nativeTask(command, { id: run.id });
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setActing(false);
    }
  };
  /** Start a fresh attempt at this task and follow it. */
  const retry = async () => {
    if (retrying || submitting) return;
    setRetrying(true);
    setError('');
    try {
      const id = await retryTask(run.id);
      await refresh();
      useExecutionStore.getState().select(id);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setRetrying(false);
    }
  };

  const continueTask = async (stopPreview = false) => {
    if (!reply.trim() || acting || submitting || !canContinue) return;
    setActing(true);
    setError('');
    const prompt = reply.trim();
    try {
      if (stopPreview) await nativeTask('task_preview_stop', { id: run.id });
      if (active) {
        await nativeTask('task_stop', { id: run.id });
        await waitForStoppedAttempt(
          run.id,
          async () => {
            await refresh();
            return useExecutionStore.getState().runs.find((r) => r.id === run.id);
          },
          () => new Promise((resolve) => setTimeout(resolve, 250)),
        );
      }
      if (latestAttempt(useExecutionStore.getState().runs, run.taskId)?.id !== run.id)
        throw new Error('A newer attempt exists. Open the latest result before continuing.');
      await start({
        projectId: run.projectId,
        projectName: run.projectName,
        projectPath: run.projectPath,
        agent: run.agent,
        prompt,
        isolated: false,
        previousRunId: run.id,
        connectionIds: drafts[key]?.connectionIds,
      });
      if (useExecutionStore.getState().drafts[key]?.prompt.trim() === prompt)
        draft(key, { prompt: '' });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setActing(false);
    }
  };
  const queueFollowUp = async (interrupt = false) => {
    if (!reply.trim() || acting || submitting || queueing || !canContinue) return;
    setQueueing(true);
    setError('');
    const prompt = reply.trim();
    const connectionIds = drafts[key]?.connectionIds;
    const requestKey = JSON.stringify([run.id, prompt, connectionIds, interrupt]);
    if (queueRequest.current?.key !== requestKey)
      queueRequest.current = { key: requestKey, id: crypto.randomUUID() };
    try {
      await nativeTask('task_followup_queue', {
        id: queueRequest.current.id,
        runId: run.id,
        prompt,
        connectionIds: connectionIds ?? null,
        interrupt,
      });
      queuedHere.current = true;
      if (useExecutionStore.getState().drafts[key]?.prompt.trim() === prompt)
        draft(key, { prompt: '' });
      queueRequest.current = null;
      setFollowups(
        (await nativeTask<TaskFollowUp[]>('task_followup_snapshot', { taskId: run.taskId })) ?? [],
      );
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setQueueing(false);
    }
  };
  const updateFollowUp = async (id: string, action: 'resume' | 'cancel') => {
    if (queueing) return;
    setQueueing(true);
    setError('');
    try {
      await nativeTask('task_followup_action', { id, action });
      if (action === 'resume') queuedHere.current = true;
      const remaining =
        (await nativeTask<TaskFollowUp[]>('task_followup_snapshot', { taskId: run.taskId })) ?? [];
      if (action === 'cancel' && !remaining.length) queuedHere.current = false;
      setFollowups(remaining);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setQueueing(false);
    }
  };
  const sendFollowUp = () =>
    active || followups.length ? queueFollowUp() : continueTask(previewRunning);
  const openLink = useCallback(async (href: string) => {
    try {
      if (isTauriEnvironment()) {
        const { open } = await import('@tauri-apps/plugin-shell');
        await open(href);
      } else window.open(href, '_blank', 'noopener,noreferrer');
    } catch (cause) {
      setError(String(cause));
    }
  }, []);
  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(run.result);
      setNotice('Result copied.');
    } catch (cause) {
      setError(`Could not copy the result: ${String(cause)}`);
    }
  };
  const captureRecovery = () => {
    const id = useTaskStore.getState().addTask({
      projectId: run.projectId,
      title: `Continue: ${title}`.slice(0, 160),
      rawPrompt: recoveryHandoff(
        run,
        sourceIdea?.rawPrompt ?? attempts[0]?.prompt ?? run.prompt,
        reply,
      ),
      contextSelection: {
        workflowId: run.contextReceipt?.entries.find((e) => e.kind === 'workflow')?.id,
        inputValues: run.contract?.inputs,
        outcomes: (run.contract?.requirements ?? [])
          .filter((r) => !r.checkpoint)
          .map((r) => r.title),
      },
      connectionIds: run.connectionIds ?? undefined,
      assignedAgent: run.agent,
      status: 'backlog',
    });
    onCapture(id);
  };
  const outcomes = !!run.contract?.requirements.length && (
    <section className="task-review-section">
      <h3 className="font-medium">Requirements · {run.contract.requirements.length}</h3>
      <TaskOutcomes
        key={`${run.id}:${run.verification?.checkedAt ?? 'unchecked'}`}
        run={run}
        canReview={finished && isLatest && !integrated}
        onCorrect={(prompt) => draft(key, { prompt: appendFeedbackDraft(reply, prompt, 24000) })}
        onAdvance={async () => {
          await start({
            projectId: run.projectId,
            projectName: run.projectName,
            projectPath: run.projectPath,
            agent: run.agent,
            prompt:
              'Continue with the next agreed workflow step. Preserve completed work and report evidence for this step.',
            isolated: false,
            previousRunId: run.id,
            contextSelection: { advanceWorkflow: true },
          });
        }}
      />
    </section>
  );
  const evidence = !!(run.validationSteps?.length || run.screenshots?.length) && (
    <section className="task-review-section">
      <h3 className="font-medium">Agent evidence</h3>
      <ValidationJourney
        runId={run.id}
        steps={run.validationSteps ?? []}
        screenshots={run.screenshots ?? []}
      />
    </section>
  );
  if (run.detailsOmitted)
    return (
      <WorkspacePage className="task-detail" aria-busy="true">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft size={16} />
          All tasks
        </Button>
        <WorkspaceHeading title={title} />
        <p role="status">Loading task…</p>
      </WorkspacePage>
    );
  return (
    <WorkspacePage className="task-detail">
      <div className="task-detail-navigation">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft size={16} />
          All tasks
        </Button>
        <WorkspaceHeading title={title} titleRef={heading} description={run.projectName} />
        <WorkContext key={`context:${run.taskId}`} run={run} />
        {isLatest && !integrated && (
          <WorkFeedbackInbox
            key={`feedback:${run.taskId}`}
            taskId={run.taskId}
            onFeedback={(text) =>
              draft(key, {
                prompt: appendFeedbackDraft(
                  useExecutionStore.getState().drafts[key]?.prompt ?? '',
                  text,
                  24000,
                ),
              })
            }
          />
        )}
        <div className="task-detail-utilities">
          <WorkSourceLink prompts={attempts.map((attempt) => attempt.prompt)} />
          {attempts.length > 1 && (
            <Select
              aria-label="Attempt history"
              value={run.id}
              onValueChange={(id) => useExecutionStore.getState().select(id)}
            >
              {attempts.map((attempt, index) => (
                <SelectItem key={attempt.id} value={attempt.id}>
                  Attempt {index + 1} · {statusLabel[attempt.status]}
                </SelectItem>
              ))}
            </Select>
          )}
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button variant="outline" aria-label="More task actions">
                <MoreHorizontal size={20} />
              </Button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content
                className="workspace-menu"
                align="end"
                sideOffset={8}
                collisionPadding={12}
              >
                {!!run.result && (
                  <Menu.Item className="workspace-menu-item" onSelect={() => void copyResult()}>
                    <Copy size={16} />
                    Copy output
                  </Menu.Item>
                )}
                {finished && isLatest && (
                  <Menu.Item className="workspace-menu-item" onSelect={onSchedule}>
                    <CalendarClock size={16} />
                    Make recurring
                  </Menu.Item>
                )}
                {finished && isLatest && run.status === 'review' && (
                  <Menu.Item
                    className="workspace-menu-item"
                    disabled={acting || !!run.persistenceError}
                    onSelect={() => void act('task_mark_reviewed')}
                  >
                    <Check size={16} /> Mark reviewed
                  </Menu.Item>
                )}
                {finished && isLatest && isolated && (
                  <Menu.Item
                    className="workspace-menu-item"
                    onSelect={() => {
                      setTab('changes');
                      setIntegrating(true);
                      setReviewSection('delivery');
                    }}
                  >
                    <GitMerge size={16} /> {integrated ? 'Merge receipt' : 'Review and merge'}
                  </Menu.Item>
                )}
                <Menu.Item
                  className="workspace-menu-item"
                  onSelect={() => {
                    setTab('activity');
                    setDetailsOpen(true);
                  }}
                >
                  Task details
                </Menu.Item>
                {finished && (
                  <Menu.Item
                    className="workspace-menu-item"
                    onSelect={() => {
                      setTab('changes');
                      setReviewSection('delivery');
                    }}
                  >
                    PR, CI &amp; delivery
                  </Menu.Item>
                )}
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>
      <TaskProgress
        run={run}
        integrated={integrated}
        pending={pending.length}
        verifyCommand={currentProject?.preferences?.verifyCommand}
        onActivity={() => setTab('activity')}
        action={
          active ? (
            <div className="task-detail-utilities">
              {!!pending.length && (
                <Button onClick={() => inspect('question')}>Answer question</Button>
              )}
              <Button
                variant="outline"
                disabled={acting || run.status === 'stopping'}
                onClick={() => void act('task_stop')}
              >
                <Square size={14} />
                Stop
              </Button>
            </div>
          ) : isLatest ? (
            <div className="task-detail-utilities">
              {run.workspace && run.status !== 'interrupted' && !integrated && (
                <Button variant="outline" onClick={() => setTab('preview')}>
                  <Play size={16} />
                  Try result
                </Button>
              )}
              <Button
                disabled={acting || submitting}
                loading={acting}
                loadingLabel="Working…"
                onClick={() => void primaryAction()}
              >
                {decision.action}
              </Button>
            </div>
          ) : undefined
        }
      />
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {notice && (
        <p role="status" className="task-muted">
          {notice}
        </p>
      )}
      {!isLatest && latest && (
        <div className="task-notice">
          <span>You’re viewing an earlier attempt.</span>
          <Button variant="outline" onClick={() => useExecutionStore.getState().select(latest.id)}>
            Open latest result
          </Button>
        </div>
      )}
      <div id="task-recovery">
        <TaskSaveRecovery run={run} />
      </div>
      {run.dependencyInvalidated && (
        <InlineNotice tone="error">
          A predecessor was retried. Preserve this work and create a fresh feature plan before
          continuing or integrating.
        </InlineNotice>
      )}
      {run.error && (
        <TaskFailure
          message={run.error}
          preparation={run.preparation}
          retrying={retrying}
          onRetry={isLatest && canRetry(run) && !integrated ? () => void retry() : undefined}
          onInspect={() => setTab('activity')}
        />
      )}
      {!!pending.length && (
        <div className="space-y-3 mb-5" id="task-questions">
          <h2 className="text-base">{active ? 'A decision needs you' : 'Questions left open'}</h2>
          {pending.map((p) => (
            <UserPromptCard
              key={p.id}
              runId={run.id}
              prompt={p}
              active={['starting', 'running'].includes(run.status)}
            />
          ))}
        </div>
      )}
      <Tabs.Root className="task-working-area" value={tab} onValueChange={setTab}>
        <div className="task-view-controls">
          <Tabs.List className="result-tabs" aria-label="Task sections">
            {[
              { value: 'result', label: 'Result' },
              { value: 'changes', label: 'Review' },
              { value: 'preview', label: 'Preview' },
              { value: 'activity', label: 'Activity' },
            ].map(({ value, label }) => (
              <Tabs.Trigger key={value} value={value}>
                {label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {['changes', 'preview'].includes(tab) && (
            <Button
              variant="ghost"
              className="conversation-toggle"
              aria-pressed={split}
              onClick={() => useWorkViewStore.getState().setSplit(run.taskId, !split)}
            >
              {split ? 'Hide conversation' : 'Show conversation'}
            </Button>
          )}
        </div>
        <div className="result-canvas" data-alongside={alongside || undefined}>
          <Tabs.Content value="result" forceMount hidden={tab !== 'result' && !alongside}>
            {attempts
              .filter((attempt) => Date.parse(attempt.startedAt) < Date.parse(run.startedAt))
              .map((attempt, index) => (
                <Disclosure key={attempt.id} className="my-3">
                  <DisclosureSummary>
                    Earlier exchange {index + 1} · {statusLabel[attempt.status]}
                  </DisclosureSummary>
                  <p className="task-request whitespace-pre-wrap">{attempt.prompt}</p>
                  <Suspense fallback={<p>{attempt.result}</p>}>
                    <TaskMarkdown
                      content={attempt.result || 'No result recorded.'}
                      active={false}
                      onOpenLink={openLink}
                    />
                  </Suspense>
                </Disclosure>
              ))}
            {attempts.length > 1 && (
              <p className="task-request whitespace-pre-wrap">{run.prompt}</p>
            )}
            {!!run.screenshots?.length && (
              <figure className="result-preview">
                <ScreenshotPreview
                  key={`${run.screenshots.at(-1)?.id}:${imageAttempt}`}
                  runId={run.id}
                  screenshot={run.screenshots[run.screenshots.length - 1]}
                  onRetry={() => setImageAttempt((n) => n + 1)}
                />
                <figcaption className="task-muted">
                  {run.screenshots.at(-1)?.name} · Recorded by the agent
                </figcaption>
              </figure>
            )}
            {run.result ? (
              <div className="task-result-text">
                <Suspense
                  fallback={
                    <p role="status" className="task-muted">
                      Opening result…
                    </p>
                  }
                >
                  <TaskMarkdown content={run.result} active={active} onOpenLink={openLink} />
                </Suspense>
              </div>
            ) : (
              <p className="task-muted">
                {active
                  ? 'Waiting for the agent’s output…'
                  : 'No final output recorded. Review the workspace or activity to see where this attempt ended.'}
              </p>
            )}
          </Tabs.Content>
          {((!active && run.workspace) || tab === 'changes') && (
            <Tabs.Content value="changes" forceMount hidden={tab !== 'changes'}>
              <ResultReview
                canApprove={isLatest && finished}
                visible={tab === 'changes'}
                section={reviewSection}
                onSectionChange={setReviewSection}
                outcomes={outcomes}
                evidence={evidence}
                key={run.id}
                run={run}
                unavailable={
                  integrated || active || !run.workspace ? (
                    <p className="task-muted">
                      {integrated
                        ? 'The reviewed patch and cleanup results are saved in the merge receipt.'
                        : active
                          ? 'Changes become available for review after this attempt stops.'
                          : 'No workspace was recorded for this attempt. Inspect its result and activity.'}
                    </p>
                  ) : undefined
                }
                onCorrect={
                  canContinue
                    ? (text) => {
                        const prompt = appendFeedbackDraft(reply, text, 24000);
                        draft(key, { prompt });
                        document.getElementById('task-reply')?.focus();
                      }
                    : undefined
                }
                delivery={
                  finished && (
                    <>
                      {isLatest && isolated && <TaskIntegration run={run} onApplied={applied} />}
                      <TaskDelivery
                        key={run.id}
                        run={run}
                        integrated={integrated}
                        onReview={() => {
                          setTab('changes');
                          setReviewSection('changes');
                        }}
                        onHandoff={(text) => {
                          const id = useTaskStore.getState().addTask({
                            projectId: run.projectId,
                            title: `Deliver: ${title}`.slice(0, 160),
                            rawPrompt: text,
                            status: 'backlog',
                          });
                          onCapture(id);
                        }}
                      />
                      {isLatest && <TaskLearning run={run} allowSave />}
                    </>
                  )
                }
              />
            </Tabs.Content>
          )}
          <Tabs.Content value="activity">
            <TaskActivity entries={run.activity} active={active} />
            <Disclosure
              open={detailsOpen}
              onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
              className="my-4"
            >
              <DisclosureSummary>Task details</DisclosureSummary>
              <section className="task-environment" aria-label="Context, history and usage">
                {run.status !== 'reviewed' && (
                  <TaskLearning key={`knowledge:${run.id}`} run={run} />
                )}
                <DefinitionList
                  items={[
                    { label: 'Agent', value: run.agent },
                    { label: 'Model', value: run.model || 'Agent default' },
                    { label: 'Account', value: run.accountBinding?.label || run.account },
                    { label: 'Started', value: new Date(run.startedAt).toLocaleString() },
                    ...(run.endedAt
                      ? [{ label: 'Ended', value: new Date(run.endedAt).toLocaleString() }]
                      : []),
                    {
                      label: 'Workspace',
                      value: run.workspace || (active ? 'Preparing' : 'Not recorded'),
                    },
                    { label: 'Branch', value: run.branch || 'Not recorded' },
                    { label: 'Target', value: run.targetBranch || 'Not recorded' },
                  ]}
                />
                {!!run.dependencySnapshot?.sources.length && (
                  <Disclosure className="task-notice">
                    <DisclosureSummary>
                      Verified feature inputs ({run.dependencySnapshot.sources.length})
                    </DisclosureSummary>
                    {run.dependencySnapshot.sources.map((source) => (
                      <p key={source.runId}>
                        {source.runId} · {source.tree.slice(0, 12)}
                      </p>
                    ))}
                  </Disclosure>
                )}
                <Disclosure className="my-4">
                  <DisclosureSummary>Original request</DisclosureSummary>
                  <p className="task-request whitespace-pre-wrap">
                    {attempts[0]?.prompt ?? run.prompt}
                  </p>
                </Disclosure>
                {attempts.length > 1 && (
                  <Disclosure className="my-4">
                    <DisclosureSummary>Instruction for this attempt</DisclosureSummary>
                    <p className="task-request whitespace-pre-wrap">{run.prompt}</p>
                  </Disclosure>
                )}
                {routing && (
                  <Disclosure className="my-4">
                    <DisclosureSummary>Agent selection and handoffs</DisclosureSummary>
                    {!routing.decisions.length && (
                      <p className="task-muted">
                        Checking available agents, models and account quotas.
                      </p>
                    )}
                    <ol className="space-y-3 mt-3">
                      {routing.decisions.map((decision, index) => (
                        <li key={decision.checkedAt}>
                          <p>
                            {decision.agent} · {decision.model || 'CLI default model'} ·{' '}
                            {decision.account}
                          </p>
                          <p className="task-muted">{decision.reason}</p>
                          <p className="task-muted">
                            Selected by {decision.orchestrator} ·{' '}
                            {decision.remainingPercent === null
                              ? 'Quota unknown'
                              : `${Math.round(decision.remainingPercent)}% headroom after local reservations at selection`}{' '}
                            · Routing usage:{' '}
                            {decision.usage.reported
                              ? `${(decision.usage.input + decision.usage.output).toLocaleString()} tokens`
                              : 'not reported'}
                          </p>
                          {routing.handoffs[index] && (
                            <p className="task-muted">
                              Quota handoff · {routing.handoffs[index].failure.message} · Worker
                              usage:{' '}
                              {routing.handoffs[index].usage.reported
                                ? `${(routing.handoffs[index].usage.input + routing.handoffs[index].usage.output).toLocaleString()} tokens`
                                : 'not reported'}
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                  </Disclosure>
                )}
                {run.prompts
                  ?.filter((p) => p.status === 'answered')
                  .map((p) => (
                    <UserPromptCard key={p.id} runId={run.id} prompt={p} active={false} />
                  ))}
                <p className="task-muted mt-3">
                  {run.requestedServiceTier && (
                    <>
                      Codex processing requested:{' '}
                      {run.requestedServiceTier === 'fast' ? 'Fast · higher usage' : 'Standard'}.
                      Provider confirmation is unavailable.
                      <br />
                    </>
                  )}
                  {run.effort && (
                    <>
                      Task approach: {run.effort} · Model effort:{' '}
                      {run.reasoningEffort ? `${run.reasoningEffort} requested` : 'Agent default'}
                      <br />
                    </>
                  )}
                  Reported usage:{' '}
                  {run.usage.reported ? describeRunUsage(run) : 'Unavailable for this attempt'}
                </p>
                <TaskTiming run={run} />
                {run.mcpUsage && (
                  <Disclosure className="my-3">
                    <DisclosureSummary>
                      Tool discovery · {run.mcpUsage.calls}{' '}
                      {run.mcpUsage.calls === 1 ? 'call' : 'calls'}
                    </DisclosureSummary>
                    <p className="task-muted mt-2">
                      Searches: {run.mcpUsage.searches} · Catalog tools: {run.mcpUsage.catalogTools}{' '}
                      · Failed calls: {run.mcpUsage.failures}
                    </p>
                    <p className="task-muted">
                      {(run.mcpUsage.schemaBytesReturned / 1024).toFixed(1)} KB tool definitions
                      returned across searches (catalog size:{' '}
                      {(run.mcpUsage.catalogBytes / 1024).toFixed(1)} KB).
                    </p>
                  </Disclosure>
                )}
                {!!run.diagnostics.length && (
                  <Disclosure>
                    <DisclosureSummary>Agent diagnostics</DisclosureSummary>
                    <pre className="task-output">{run.diagnostics.join('\n\n')}</pre>
                  </Disclosure>
                )}
              </section>
              {isLatest && (
                <Disclosure className="my-4">
                  <DisclosureSummary>Connections for the next step</DisclosureSummary>
                  <p className="task-muted">Changes apply to the next continuation.</p>
                  {connections?.map((server) => (
                    <label key={server.id} className="flex items-center gap-3 min-h-11">
                      <Checkbox
                        checked={(
                          drafts[key]?.connectionIds ??
                          run.connectionIds ??
                          connections.map((s) => s.id)
                        ).includes(server.id)}
                        onChange={(event) => {
                          const ids =
                            drafts[key]?.connectionIds ??
                            run.connectionIds ??
                            connections.map((s) => s.id);
                          draft(key, {
                            connectionIds: event.target.checked
                              ? [...ids, server.id]
                              : ids.filter((id) => id !== server.id),
                          });
                        }}
                      />
                      {server.name}
                    </label>
                  ))}
                  <Button
                    variant="outline"
                    onClick={() => {
                      useProjectStore.getState().selectProject(run.projectId);
                      setToolsOpen(true);
                    }}
                  >
                    Manage task connections
                  </Button>
                </Disclosure>
              )}
              {!active && !run.detailsOmitted && (
                <FeedbackTouchpoint
                  key={run.id}
                  runId={run.id}
                  paused={acting || integrating || !!reply.trim() || pending.length > 0}
                />
              )}
              {run.status === 'reviewed' && <TaskLearning key={`learning:${run.id}`} run={run} />}
              {!active && currentProject && (
                <WorkspaceReadiness
                  key={`readiness:${run.id}`}
                  project={currentProject}
                  path={run.workspace || run.projectPath}
                />
              )}
            </Disclosure>
          </Tabs.Content>
          <Tabs.Content value="preview">
            {!active && run.status !== 'interrupted' && run.workspace && !integrated ? (
              <TaskPreview
                key={`preview:${run.id}`}
                run={run}
                onFeedback={
                  canContinue
                    ? (text) => {
                        const prompt = appendFeedbackDraft(reply, text, 24000);
                        draft(key, { prompt });
                        document.getElementById('task-reply')?.focus();
                      }
                    : undefined
                }
              />
            ) : (
              <p className="task-muted">
                {integrated
                  ? 'These changes are integrated. Start a new task from the updated project to preview further changes.'
                  : 'Finish or stop work before trying this result.'}
              </p>
            )}
          </Tabs.Content>
        </div>
      </Tabs.Root>
      {isLatest && (
        <div className="task-next">
          <h2 className="task-followup-heading">
            {integrated ? 'Start a follow-up' : 'Follow-up'}
          </h2>
          {queueError && <InlineNotice tone="error">{queueError}</InlineNotice>}
          {followups.length > 0 && (
            <ul className="task-followup-queue" aria-label="Queued follow-ups">
              {followups.map((item) => (
                <li key={item.id}>
                  <p>{item.prompt}</p>
                  <div className="task-followup-footer">
                    <p className="task-muted">
                      {item.error ??
                        (item.paused
                          ? 'Queue paused. Resume when ready.'
                          : 'Queued for the next attempt.')}
                    </p>
                    {item.paused && !item.runId && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={queueing}
                        onClick={() => void updateFollowUp(item.id, 'resume')}
                      >
                        Resume
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={queueing}
                      onClick={() => void updateFollowUp(item.id, 'cancel')}
                    >
                      Cancel follow-up
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {canContinue ? (
            <form
              className="task-followup-form"
              onSubmit={(event) => {
                event.preventDefault();
                void sendFollowUp();
              }}
            >
              <Textarea
                id="task-reply"
                aria-label="Follow-up instructions"
                className="task-reply"
                rows={2}
                value={reply}
                onChange={(event) => draft(key, { prompt: event.target.value })}
                placeholder="Tell Jackalope what to do next…"
                maxLength={24000}
                onKeyDown={(event) => {
                  if (
                    (event.ctrlKey || event.metaKey) &&
                    event.key === 'Enter' &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void sendFollowUp();
                  }
                }}
              />
              <div className="task-followup-footer">
                <p className="task-muted">
                  {followups.length && previewRunning
                    ? 'Queued follow-ups wait until the managed preview stops.'
                    : previewRunning
                      ? 'Stops the managed preview, saves its logs, then continues in this workspace.'
                      : active
                        ? 'Queue for the next attempt, or stop current work and send now.'
                        : `Continues with ${run.agent} in the same workspace and account.`}
                </p>
                {active && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      !reply.trim() || submitting || acting || queueing || run.status === 'stopping'
                    }
                    onClick={() => void queueFollowUp(true)}
                  >
                    Stop &amp; send
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={
                    !reply.trim() || submitting || acting || queueing || run.status === 'stopping'
                  }
                  loading={acting || submitting || queueing}
                  loadingLabel={active || followups.length ? 'Queuing…' : 'Continuing…'}
                >
                  {active || followups.length
                    ? 'Queue follow-up'
                    : previewRunning
                      ? 'Stop preview and continue'
                      : 'Continue task'}
                  <ArrowRight size={15} />
                </Button>
              </div>
            </form>
          ) : (
            <>
              <p className="task-muted mb-3">
                {run.status === 'interrupted'
                  ? 'Inspect the agent session and workspace before starting more work; ownership could not be confirmed after interruption.'
                  : integrated
                    ? 'Start a new task from the updated target branch, with this result attached.'
                    : active
                      ? 'A follow-up becomes available when the agent reports a resumable session.'
                      : 'This attempt has no resumable session. Carry its context into a new task to continue.'}
              </p>
              {!active && run.status !== 'interrupted' && (
                <Button variant="outline" onClick={captureRecovery}>
                  Continue in a new task
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {toolsOpen && (
        <Suspense fallback={null}>
          <TaskTools
            onClose={() => {
              setToolsOpen(false);
              void listMcpServers(run.projectId)
                .then((servers) =>
                  setConnections(
                    servers.filter(
                      (s) => s.enabled !== false && s.scope === `project:${run.projectId}`,
                    ),
                  ),
                )
                .catch((cause) => setError(String(cause)));
            }}
          />
        </Suspense>
      )}
    </WorkspacePage>
  );
}
