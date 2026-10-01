import {
  Badge,
  Checkbox,
  Disclosure,
  DisclosureSummary,
  DropdownMenu as Menu,
} from '@jackalope/ui';
import {
  ArrowLeft,
  CalendarClock,
  Check,
  Copy,
  GitMerge,
  MailPlus,
  MoreHorizontal,
  Play,
  Square,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getAgentMetadata } from '../../lib/agent-catalog';
import { waitForStoppedAttempt } from '../../lib/continue-task';
import { projectConnections } from '../../lib/mcp-connection';
import { recoveryHandoff } from '../../lib/project-return';
import { appendFeedbackDraft } from '../../lib/review-feedback';
import {
  canRetry,
  isActive,
  nativeTask,
  PROMPT_MAX_CHARS,
  retryTask,
  statusLabel,
  type TaskRun,
} from '../../lib/task-runtime';
import { taskTitle } from '../../lib/task-title';
import { latestAttempt, taskDecision } from '../../lib/task-workflow';
import { listMcpServers, type McpServerConfig, openInBrowser } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { useWorkbenchStore } from '../../stores/workbenchStore';
import { useWorkSignalsStore } from '../../stores/workSignalsStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { TaskLearning } from '../knowledge/TaskLearning';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceTabs as Tabs } from '../ui/WorkspaceTabs';
import { AgentScreen } from './AgentScreen';
import { FeedbackTouchpoint } from './FeedbackTouchpoint';
import { ResultReview, type ReviewSection } from './ResultReview';
import { ScreenshotPreview } from './ScreenshotPreview';
import { TaskActivity } from './TaskActivity';
import { TaskComparison } from './TaskComparison';
import { TaskDelivery } from './TaskDelivery';
import { TaskFailure } from './TaskFailure';
import { TaskFollowUpPanel } from './TaskFollowUpPanel';
import { TaskIntegration } from './TaskIntegration';
import { TaskOutcomes } from './TaskOutcomes';
import { TaskPreview } from './TaskPreview';
import { TaskProgress } from './TaskProgress';
import { TaskRunDetails } from './TaskRunDetails';
import { TaskSaveRecovery } from './TaskSaveRecovery';
import { UserPromptCard } from './UserPromptCard';
import { useManagedPreview } from './useManagedPreview';
import { useTaskFollowUps } from './useTaskFollowUps';
import { ValidationJourney } from './ValidationJourney';
import { WorkContext } from './WorkContext';
import { WorkFeedbackInbox } from './WorkFeedbackInbox';
import { WorkSourceLink } from './WorkSourceLink';
import { WorkspaceReadiness } from './WorkspaceReadiness';
import './task-detail.css';

const TaskMarkdown = lazy(() => import('./TaskMarkdown'));
const TaskTerminal = lazy(() =>
  import('./TaskTerminal').then((module) => ({ default: module.TaskTerminal })),
);
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
  const { runs, start, submitting, refresh, drafts, draft } = useExecutionStore(
    useShallow((s) => ({
      runs: s.runs,
      start: s.start,
      submitting: s.submitting,
      refresh: s.refresh,
      drafts: s.drafts,
      draft: s.draft,
    })),
  );
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!run.detailsOmitted) heading.current?.focus();
  }, [run.detailsOmitted]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [acting, setActing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const workRequest = useWorkViewStore((state) => state.request);
  const preset = useWorkbenchStore((state) => state.presets[run.projectId] ?? 'focus');
  const savedTab = useWorkViewStore.getState().reading[run.taskId];
  const [tab, setTab] = useState(
    savedTab === 'context'
      ? 'activity'
      : savedTab === 'delivery'
        ? 'changes'
        : (savedTab ?? (preset === 'build' ? 'changes' : 'result')),
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
  const split = useWorkViewStore((state) => state.split[run.taskId] ?? preset === 'build');
  const alongside = split && ['changes', 'preview', 'terminal', 'activity', 'screen'].includes(tab);
  const reply = drafts[key]?.prompt ?? '';
  const active = isActive(run);
  const previewRunning = useManagedPreview(run.id, !active && !integrated);
  const attempts = runs
    .filter((r) => r.taskId === run.taskId)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const latest = latestAttempt(runs, run.taskId);
  const isLatest = latest?.id === run.id;
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
  /** Adds review or preview feedback to the follow-up draft, keeping what is typed. */
  const addToReply = (text: string, focus = false) => {
    const current = useExecutionStore.getState().drafts[key]?.prompt ?? '';
    draft(key, { prompt: appendFeedbackDraft(current, text, PROMPT_MAX_CHARS) });
    if (focus) document.getElementById('task-reply')?.focus();
  };
  const pending = run.prompts?.filter((p) => p.status === 'pending') ?? [];
  const isolated =
    !!run.workspace &&
    run.workspace.replaceAll('\\', '/').toLowerCase() !==
      run.projectPath.replaceAll('\\', '/').toLowerCase();
  const finished = !active && ['review', 'reviewed'].includes(run.status);
  const canContinue = isLatest && !!run.sessionId && run.status !== 'interrupted' && !integrated;
  const decision = taskDecision(run, integrated, currentProject?.preferences?.verifyCommand);
  const { followups, queueError, queueing, queueFollowUp, updateFollowUp } = useTaskFollowUps({
    run,
    draftKey: key,
    reply,
    canContinue,
    blocked: acting || submitting,
    busy: active,
    onError: setError,
  });
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
    if (tab !== 'activity' || !detailsOpen || !isLatest || connections !== null) return;
    let alive = true;
    void listMcpServers(run.projectId)
      .then((servers) => {
        if (alive) setConnections(projectConnections(servers, run.projectId));
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      });
    return () => {
      alive = false;
    };
  }, [tab, detailsOpen, isLatest, connections, run.projectId]);
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
  const sendFollowUp = () =>
    active || followups.length ? queueFollowUp() : continueTask(previewRunning);
  const openLink = useCallback(async (href: string) => {
    try {
      await openInBrowser(href);
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
        onCorrect={(prompt) => addToReply(prompt)}
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
        <WorkspaceHeading
          title={title}
          titleRef={heading}
          description={
            active ? (
              run.projectName
            ) : (
              <span className="task-heading-meta">
                <Badge appearance="plain" variant={decision.tone}>
                  {decision.label}
                </Badge>
                <span>
                  {run.projectName} · {getAgentMetadata(run.agent)?.name ?? run.agent} ·{' '}
                  {run.accountBinding?.label || run.account}
                </span>
              </span>
            )
          }
        />
        {isLatest && !integrated && (
          <WorkFeedbackInbox
            key={`feedback:${run.taskId}`}
            taskId={run.taskId}
            onFeedback={(text) => addToReply(text)}
          />
        )}
        <div className="task-detail-utilities">
          {!active && isLatest && (
            <>
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
            </>
          )}
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
                <Menu.Item
                  className="workspace-menu-item"
                  onSelect={() => {
                    useWorkSignalsStore.getState().markUnread(run.taskId);
                    onBack();
                  }}
                >
                  <MailPlus size={16} /> Mark unread
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
      <div className="task-status-stack">
        <TaskComparison run={run} />
        {active && (
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
              ) : undefined
            }
          />
        )}
      </div>
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
              { value: 'terminal', label: 'Terminal' },
              { value: 'screen', label: 'Screen' },
              { value: 'activity', label: 'Activity' },
            ].map(({ value, label }) => (
              <Tabs.Trigger key={value} value={value}>
                {label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <div className="task-view-tools">
            {['changes', 'preview', 'terminal', 'activity', 'screen'].includes(tab) && (
              <Button
                variant="ghost"
                className="conversation-toggle"
                aria-pressed={split}
                onClick={() => useWorkViewStore.getState().setSplit(run.taskId, !split)}
              >
                {split ? 'Hide conversation' : 'Show conversation'}
              </Button>
            )}
            <WorkContext
              key={`context:${run.taskId}`}
              run={run}
              onTerminal={() => setTab('terminal')}
              hideTerminal
            />
          </div>
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
                onCorrect={canContinue ? (text) => addToReply(text, true) : undefined}
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
              <TaskRunDetails run={run} attempts={attempts} active={active} />
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
          <Tabs.Content value="terminal">
            <Suspense fallback={<p>Loading terminal…</p>}>
              <TaskTerminal run={run} />
            </Suspense>
          </Tabs.Content>
          <Tabs.Content value="screen">
            <AgentScreen run={run} visible={tab === 'screen'} />
          </Tabs.Content>
          <Tabs.Content value="preview">
            {!active && run.status !== 'interrupted' && run.workspace && !integrated ? (
              <TaskPreview
                key={`preview:${run.id}`}
                run={run}
                onFeedback={canContinue ? (text) => addToReply(text, true) : undefined}
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
        <TaskFollowUpPanel
          run={run}
          active={active}
          integrated={integrated}
          canContinue={canContinue}
          previewRunning={previewRunning}
          reply={reply}
          followups={followups}
          queueError={queueError}
          queueing={queueing}
          acting={acting}
          submitting={submitting}
          onReply={(text) => draft(key, { prompt: text })}
          onSend={() => void sendFollowUp()}
          onStopAndSend={() => void queueFollowUp(true)}
          onUpdate={(id, action) => void updateFollowUp(id, action)}
          onRecover={captureRecovery}
        />
      )}
      {toolsOpen && (
        <Suspense fallback={null}>
          <TaskTools
            onClose={() => {
              setToolsOpen(false);
              void listMcpServers(run.projectId)
                .then((servers) => setConnections(projectConnections(servers, run.projectId)))
                .catch((cause) => setError(String(cause)));
            }}
          />
        </Suspense>
      )}
    </WorkspacePage>
  );
}
