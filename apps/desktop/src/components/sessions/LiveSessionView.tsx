import { AgentCharacter } from '@jackalope/brand/agent-character';
import { CopyButton, SegmentedControl } from '@jackalope/ui';
import {
  AlarmClock,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Minus,
  PanelRightClose,
  Pause,
  Pin,
  Play,
  Square,
  X,
} from 'lucide-react';
import { type CSSProperties, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useAgentGaze } from '../../hooks/useAgentGaze';
import { BOT_BATCH_ALLOWANCE, batchLimitReached } from '../../lib/bot-conversations';
import { type BotCard, useBotHubStore } from '../../lib/bot-hub';
import {
  type LiveSession,
  type MessageOrigin,
  type SessionReview,
  sessionCommand,
  sessionRunNeedsAttention,
  sessionWork,
} from '../../lib/live-session';
import { isActive, nativeTask, respondToPrompt, type TaskRun } from '../../lib/task-runtime';
import { taskDecision } from '../../lib/task-workflow';
import { isTauriEnvironment, openExternalUrl } from '../../lib/tauri-bridge';
import { selectWork } from '../../lib/work-selection';
import { BOT_COLORS, useBotStore } from '../../stores/botStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useProjectStore } from '../../stores/projectStore';
import { useChangeStats } from '../../stores/workSignalsStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { BotAvatar, botStyle } from '../bots/BotAvatar';
import { BotCardView } from '../bots/BotCardView';
import { TaskLearning } from '../knowledge/TaskLearning';
import { AgentQuestion } from '../tasks/AgentQuestion';
import { AgentScreen } from '../tasks/AgentScreen';
import { MergeReview } from '../tasks/MergeReview';
import { ResultReview } from '../tasks/ResultReview';
import { deliveryHandoff, TaskDelivery } from '../tasks/TaskDelivery';
import { TaskLiveActivity } from '../tasks/TaskLiveActivity';
import { TaskPreview } from '../tasks/TaskPreview';
import { useWorkSeen, WorkContextDetails } from '../tasks/WorkContext';
import { WorkFeedbackInbox } from '../tasks/WorkFeedbackInbox';
import { WorkSourceLink } from '../tasks/WorkSourceLink';
import { useWorkspaceActions } from '../tasks/WorkTools';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Tooltip } from '../ui/Tooltip';
import { ChatOptions } from './ChatOptions';
import { SessionComposer } from './SessionComposer';
import { SessionLimits } from './SessionLimits';
import { SessionRecovery } from './SessionRecovery';
import { SessionTopics } from './SessionTopics';
import { TranscriptResult } from './TranscriptResult';
import './live-session.css';

const TaskTerminal = lazy(() =>
  import('../tasks/TaskTerminal').then((module) => ({ default: module.TaskTerminal })),
);

export function LiveSessionView({
  session,
  runs,
  detached = false,
  onBack,
  simple = false,
  onOpenSession,
}: {
  session: LiveSession;
  runs: TaskRun[];
  detached?: boolean;
  /** A bot conversation returns to its bot list; work returns through the sidebar. */
  onBack?: () => void;
  /** A plain conversation for bot chats: no workspace, terminal or session tools; review appears in the transcript. */
  simple?: boolean;
  /** Opens another conversation, such as the one a bot message came from. */
  onOpenSession?: (id: string) => void;
}) {
  const { active, latest, pending, questions, status } = sessionWork(session, runs);
  const runById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs]);
  const batchById = useMemo(
    () => new Map(session.batches.map((batch) => [batch.runId, batch])),
    [session.batches],
  );
  const hubCards = useBotHubStore((state) => state.cards);
  const cardsByRun = useMemo(() => {
    const byRun = new Map<string, BotCard[]>();
    for (const card of hubCards)
      if (card.sessionId === session.id)
        byRun.set(card.runId, [...(byRun.get(card.runId) ?? []), card]);
    return byRun;
  }, [hubCards, session.id]);
  const recentBatches = useMemo(
    () => new Set(session.batches.slice(-20).map((batch) => batch.runId)),
    [session.batches],
  );
  const project = useProjectStore((state) =>
    state.projects.find((item) => item.id === session.request.projectId),
  );
  const integrated = !!session.integratedRunId;
  const nextChat = (text: string) => {
    if (detached)
      throw new Error(
        'Return to the main window to prepare a new chat. Your merged result remains available here.',
      );
    const key = `jackalope-live-start:${session.request.projectId}`;
    const existing = localStorage.getItem(key)?.trim();
    localStorage.setItem(key, existing ? `${existing}\n\n${text}` : text);
    selectWork();
  };
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // Each view takes the whole canvas; the conversation is one of them, not a sidebar.
  const [tab, setTab] = useState(() => {
    const saved = useWorkViewStore.getState().reading[`session:${session.id}`];
    return saved === 'delivery'
      ? 'changes'
      : ['changes', 'preview', 'terminal', 'screen'].includes(saved)
        ? saved
        : 'conversation';
  });
  useEffect(() => {
    useWorkViewStore.getState().remember(`session:${session.id}`, tab);
  }, [session.id, tab]);
  const workRequest = useWorkViewStore((state) => state.request);
  useEffect(() => {
    if (
      !workRequest ||
      (workRequest.id !== `session:${session.id}` &&
        !session.batches.some((batch) => batch.runId === workRequest.id))
    )
      return;
    const section = workRequest.section;
    setTab(
      ['preview', 'terminal', 'screen'].includes(section)
        ? section
        : ['changes', 'review', 'integrate', 'verify', 'delivery'].includes(section)
          ? 'changes'
          : 'conversation',
    );
  }, [workRequest, session.id, session.batches]);
  const [addition, setAddition] = useState<{
    text: string;
    revision: number;
    applied: (error?: string) => void;
  }>();
  const addingFeedback = useRef(false);
  const append = (text: string) =>
    new Promise<void>((resolve, reject) => {
      if (session.closed) {
        reject(
          new Error('This conversation is finished. Copy the delivery handoff into a new task.'),
        );
        return;
      }
      if (addingFeedback.current) {
        reject(new Error('Wait for the current feedback to be added, then try again.'));
        return;
      }
      addingFeedback.current = true;
      setAddition((value) => ({
        text,
        revision: (value?.revision ?? 0) + 1,
        applied: (error) => {
          addingFeedback.current = false;
          if (error) reject(new Error(error));
          else resolve();
        },
      }));
    });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<SessionReview | null>(null);
  const reviewAttempt = useRef('');
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const mascotRef = useRef<HTMLSpanElement>(null);
  const mascotGaze = useAgentGaze(mascotRef);
  const refresh = () => useLiveSessionStore.getState().refresh(session.id);
  const tooled = !detached && !simple;
  useWorkSeen(tooled ? latest : undefined);
  const workspace = useWorkspaceActions(tooled ? latest : undefined);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const node = transcript.current;
    if (collapsed || !node) return;
    const scroll = () => {
      if (follow.current) node.scrollTop = node.scrollHeight;
    };
    const observer = new MutationObserver(scroll);
    observer.observe(node, { childList: true, subtree: true, characterData: true });
    scroll();
    return () => observer.disconnect();
  }, [collapsed]);
  useEffect(() => {
    const node = transcript.current;
    if (tab === 'conversation' && node && follow.current) node.scrollTop = node.scrollHeight;
  }, [tab]);
  useEffect(() => {
    const attempt = `${latest?.id}:${latest?.status}:${session.paused}`;
    if (reviewAttempt.current !== attempt) {
      reviewAttempt.current = attempt;
      setReview(null);
    }
  }, [latest?.id, latest?.status, session.paused]);
  const windowAction = (action: 'minimize' | 'close') =>
    act(async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow()[action]();
    });
  const changeStats = useChangeStats(simple ? [latest] : []);
  const latestChanges = latest ? changeStats[latest.id]?.value : undefined;
  const showReview = () => {
    setTab('changes');
    if (!latest || active || integrated) return;
    void act(async () => {
      await sessionCommand('action', { id: session.id, action: 'pause' });
      reviewAttempt.current = `${latest.id}:${latest.status}:true`;
      setReview(await sessionCommand<SessionReview>('review', { id: session.id }));
    });
  };
  const bot = useBotStore((state) => state.bots.find((item) => item.id === session.persona?.botId));
  // A bot's conversation wears the bot's own character and colour instead of the agent's.
  const botLook = bot ? botStyle(bot.appearance, bot.agent) : null;
  const botColor = BOT_COLORS.find((item) => item.id === bot?.appearance?.color)?.value;
  const character = (agent: string) => botLook ?? agent;
  const provider = character(active?.agent ?? latest?.agent ?? session.request.agent);
  const screenRun = active ?? latest;
  const pauseLabel = integrated
    ? 'Integrated'
    : session.closed
      ? 'Reopen conversation'
      : session.paused
        ? 'Resume queue'
        : 'Pause queue';
  const togglePause = () =>
    void act(() =>
      sessionCommand('action', {
        id: session.id,
        action: session.paused || session.closed ? 'resume' : 'pause',
      }),
    );
  const stopWork = () =>
    void act(async () => {
      if (!active) return;
      await sessionCommand('action', { id: session.id, action: 'pause' });
      await nativeTask('task_stop', { id: active.id });
    });
  const retryable = !active && !!session.batches.at(-1)?.error;
  const tools = (
    <>
      {(!detached || (!integrated && !simple)) && (
        <ChatOptions
          actions={
            detached
              ? []
              : [
                  ...(integrated
                    ? []
                    : [{ id: 'pause', label: pauseLabel, onSelect: togglePause, disabled: busy }]),
                  ...(active
                    ? [{ id: 'stop', label: 'Stop work', onSelect: stopWork, disabled: busy }]
                    : []),
                  ...(!active && !session.closed && !simple
                    ? [
                        {
                          id: 'finish',
                          label: 'Finish conversation',
                          disabled: busy,
                          onSelect: () =>
                            void act(() =>
                              sessionCommand('action', { id: session.id, action: 'finish' }),
                            ),
                        },
                      ]
                    : []),
                  ...(simple
                    ? []
                    : [
                        {
                          id: 'topics',
                          label: session.topics?.length
                            ? `Topics · ${session.topics.length}`
                            : 'Topics',
                          onSelect: () => setTopicsOpen(true),
                        },
                      ]),
                ]
          }
          submenus={
            workspace.groups.length
              ? [{ id: 'workspace', label: 'Workspace', groups: workspace.groups }]
              : []
          }
          items={[
            ...(tooled && latest
              ? [
                  {
                    id: 'context',
                    label: 'Task context',
                    content: () => <WorkContextDetails run={latest} />,
                  },
                ]
              : []),
            {
              id: 'limits',
              label: 'Conversation limits',
              content: () => (
                <SessionLimits
                  embedded
                  initial={session.limits}
                  onSave={async (limits) => {
                    await sessionCommand('limits', { id: session.id, limits });
                    await refresh();
                  }}
                />
              ),
            },
          ].filter((item) => item.id === 'context' || (!integrated && !simple))}
        />
      )}
      {detached && (
        <Tooltip content={session.pinned ? 'Turn off always on top' : 'Always on top'}>
          <button
            type="button"
            className="app-titlebar-button"
            aria-label="Always on top"
            aria-pressed={session.pinned}
            disabled={busy}
            onClick={() =>
              void act(() =>
                sessionCommand('window_pin', { id: session.id, pinned: !session.pinned }),
              )
            }
          >
            <Pin size={16} aria-hidden="true" />
          </button>
        </Tooltip>
      )}
      <Tooltip content={detached ? 'Return to main window' : 'Pop out'}>
        <button
          type="button"
          className="app-titlebar-button"
          aria-label={detached ? 'Return to main window' : 'Pop out'}
          disabled={busy || !isTauriEnvironment()}
          onClick={() =>
            void act(() =>
              sessionCommand('window', { id: session.id, action: detached ? 'dock' : 'open' }),
            )
          }
        >
          {detached ? (
            <PanelRightClose size={16} aria-hidden="true" />
          ) : (
            <ExternalLink size={16} aria-hidden="true" />
          )}
        </button>
      </Tooltip>
      {detached && !/Mac/.test(navigator.platform) && (
        <>
          <button
            type="button"
            className="app-titlebar-button"
            aria-label="Minimize window"
            onClick={() => void windowAction('minimize')}
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            className="app-titlebar-button app-titlebar-button-close"
            aria-label="Close window"
            onClick={() => void windowAction('close')}
          >
            <X size={16} />
          </button>
        </>
      )}
    </>
  );
  const statusText = (
    <span aria-live="polite">
      {status === 'Queued'
        ? `${pending} queued`
        : latest && !active && status === 'Ready to review'
          ? taskDecision(latest).label
          : status}
      {pending && status !== 'Queued' ? ` · ${pending} queued` : ''}
    </span>
  );
  const headerActions = (
    <>
      {!simple && latest && !active && !integrated && tab !== 'changes' && (
        <Button disabled={busy} onClick={showReview}>
          Review changes
        </Button>
      )}
    </>
  );
  return (
    <section
      className={`live-session${detached ? ' live-session-detached' : ''}`}
      aria-label={session.title}
      style={botColor ? ({ '--agent-color': botColor } as CSSProperties) : undefined}
    >
      <header
        className={`live-header${detached && /Mac/.test(navigator.platform) ? ' live-header-native-mac' : ''}`}
        data-tauri-drag-region={detached || undefined}
      >
        {simple && !detached && onBack && (
          <Button variant="ghost" size="icon" aria-label="Back to bots" onClick={onBack}>
            <ArrowLeft size={18} />
          </Button>
        )}
        <span className="live-mascot" aria-hidden="true" ref={mascotRef}>
          <AgentCharacter
            provider={provider}
            state={questions.length ? 'waiting' : active ? 'working' : 'idle'}
            gaze={mascotGaze}
          />
        </span>
        <div className="live-title" data-tauri-drag-region={detached || undefined}>
          <h1 data-tauri-drag-region={detached || undefined}>{session.title}</h1>
          <span className="live-muted" data-tauri-drag-region={detached || undefined}>
            {session.persona ? `${session.persona.name} · ` : ''}
            {session.request.projectName}
          </span>
          {!detached && <span className="live-status">{statusText}</span>}
        </div>
        <div className="app-titlebar-controls">
          {!detached && headerActions}
          {tools}
        </div>
      </header>
      <SessionRecovery />
      {detached && (
        <div className="live-statusbar">
          <span className="live-status">{statusText}</span>
          <div className="live-status-actions">
            <Button
              variant="outline"
              size="icon"
              aria-label={pauseLabel}
              disabled={busy || integrated}
              onClick={togglePause}
            >
              {session.paused || session.closed ? <Play size={16} /> : <Pause size={16} />}
            </Button>
            {active && (
              <Button
                variant="outline"
                size="icon"
                aria-label="Stop work"
                disabled={busy}
                onClick={stopWork}
              >
                <Square size={16} />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={collapsed ? 'Expand conversation' : 'Collapse conversation'}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </Button>
          </div>
        </div>
      )}
      {!error && batchLimitReached(session) ? (
        <div className="live-notice">
          <InlineNotice
            tone="warning"
            action={
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await sessionCommand('limits', {
                      id: session.id,
                      limits: {
                        ...session.limits,
                        maxBatches: session.batches.length + BOT_BATCH_ALLOWANCE,
                      },
                    });
                    await sessionCommand('action', { id: session.id, action: 'resume' });
                  })
                }
              >
                Let it continue
              </Button>
            }
          >
            {session.persona?.name ?? 'This bot'} paused after {session.batches.length} replies it
            started without you. Review what it did, then let it continue for up to{' '}
            {BOT_BATCH_ALLOWANCE} more.
          </InlineNotice>
        </div>
      ) : (
        (error || workspace.error || session.error || retryable) && (
          <div className="live-notice">
            <InlineNotice
              tone="error"
              action={
                retryable && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void act(() => sessionCommand('action', { id: session.id, action: 'retry' }))
                    }
                  >
                    Retry launch
                  </Button>
                )
              }
            >
              {error || workspace.error || session.error || session.batches.at(-1)?.error}
            </InlineNotice>
          </div>
        )
      )}
      {!simple && <WorkSourceLink prompts={session.messages.map((message) => message.text)} />}
      {tooled && (
        <SessionTopics
          key={`topics:${session.id}`}
          session={session}
          open={topicsOpen}
          onOpenChange={setTopicsOpen}
        />
      )}
      {latest && !detached && !session.closed && !simple && (
        <WorkFeedbackInbox
          key={`feedback:${latest.taskId}`}
          taskId={latest.taskId}
          onFeedback={append}
        />
      )}
      {(!simple || tab !== 'conversation') && (
        <div className="live-tabbar">
          <SegmentedControl
            className="live-tabs"
            label="Conversation views"
            value={tab}
            onChange={(value) => {
              if (value === 'changes') showReview();
              else {
                setTab(value);
                if (value === 'preview' && !integrated)
                  void act(() => sessionCommand('action', { id: session.id, action: 'pause' }));
              }
            }}
            items={[
              { id: 'conversation', label: 'Conversation' },
              { id: 'changes', label: 'Review' },
              ...(simple
                ? []
                : [
                    { id: 'preview', label: 'Preview' },
                    { id: 'terminal', label: 'Terminal' },
                    { id: 'screen', label: 'Screen' },
                  ]),
            ]}
          />
        </div>
      )}
      <div className="live-columns">
        <div className="live-conversation" hidden={tab !== 'conversation'}>
          {!collapsed && (
            <div
              className="live-transcript"
              ref={transcript}
              onScroll={(event) => {
                const node = event.currentTarget;
                follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
              }}
            >
              {!session.messages.length && (
                <div className="live-empty">
                  <span className="live-mascot">
                    <AgentCharacter provider={provider} />
                  </span>
                </div>
              )}
              {session.messages.map((message) => {
                const batch = message.runId ? batchById.get(message.runId) : undefined;
                const run = message.runId ? runById.get(message.runId) : undefined;
                const lastInBatch = batch?.messageIds.at(-1) === message.id;
                const origin = message.origin;
                const incoming = origin && origin.kind !== 'card';
                return (
                  <div key={message.id}>
                    <article
                      className={`live-message ${incoming ? 'live-incoming' : 'live-sent'}`}
                      data-origin={origin?.kind}
                      data-canceled={message.canceled || undefined}
                    >
                      {incoming ? (
                        <MessageOriginLabel origin={origin} onOpenSession={onOpenSession} />
                      ) : (
                        <span className={`live-author${origin ? '' : ' sr-only'}`}>
                          {origin ? `You answered “${origin.label}”` : 'You'}
                        </span>
                      )}
                      <p>{message.text}</p>
                      <div className="live-receipt">
                        {message.canceled
                          ? 'Canceled'
                          : run
                            ? isActive(run)
                              ? 'Working'
                              : sessionRunNeedsAttention(run)
                                ? 'Needs attention'
                                : ''
                            : batch?.error
                              ? 'Needs attention'
                              : 'Queued'}
                        {!message.runId && !message.canceled && (
                          <button
                            type="button"
                            aria-label="Cancel queued message"
                            onClick={() =>
                              void act(() =>
                                sessionCommand('action', {
                                  id: session.id,
                                  action: 'cancel-message',
                                  messageId: message.id,
                                }),
                              )
                            }
                          >
                            <X size={12} aria-hidden="true" />
                          </button>
                        )}
                        <CopyButton
                          className="live-copy"
                          size="sm"
                          text={message.text}
                          label="Copy"
                        />
                      </div>
                    </article>
                    {lastInBatch && run?.result && (
                      <article className="live-message live-reply">
                        <span className="live-mascot">
                          <AgentCharacter
                            provider={character(run.agent)}
                            state={isActive(run) ? 'working' : 'idle'}
                          />
                        </span>
                        <div>
                          <span className="live-author">
                            {session.persona?.name ??
                              (run.agent === 'auto' ? 'Jackalope' : run.agent)}
                          </span>
                          <Suspense fallback={<p>{run.result}</p>}>
                            <TranscriptResult
                              recent={recentBatches.has(run.id)}
                              content={run.result}
                              active={isActive(run)}
                              onOpenLink={(url) => void act(() => openExternalUrl(url))}
                            />
                          </Suspense>
                          {!isActive(run) && (
                            <CopyButton
                              className="live-copy"
                              size="sm"
                              text={run.result}
                              label="Copy reply"
                            />
                          )}
                        </div>
                      </article>
                    )}
                    {lastInBatch &&
                      run &&
                      cardsByRun.get(run.id)?.map((card) => (
                        <div key={card.id} className="live-card">
                          <BotCardView card={card} />
                        </div>
                      ))}
                    {simple &&
                      lastInBatch &&
                      run?.id === latest?.id &&
                      run &&
                      !isActive(run) &&
                      !integrated &&
                      !!latestChanges?.files && (
                        <div className="live-review-cta">
                          <span>
                            Changed {latestChanges.files}{' '}
                            {latestChanges.files === 1 ? 'file' : 'files'}
                            <small>
                              +{latestChanges.added} −{latestChanges.removed}
                            </small>
                          </span>
                          <Button disabled={busy} onClick={showReview}>
                            Review changes
                          </Button>
                        </div>
                      )}
                  </div>
                );
              })}
              {active && (
                <div className="live-working">
                  <span className="live-mascot">
                    <AgentCharacter
                      provider={character(active.agent)}
                      state={questions.length ? 'waiting' : 'working'}
                    />
                  </span>
                  <TaskLiveActivity run={active} />
                </div>
              )}
              {integrated && latest && !detached && (
                <div className="live-review-cta">
                  <span>These changes are merged.</span>
                  <Button
                    onClick={() => {
                      try {
                        nextChat(deliveryHandoff(latest, true, 'the next change'));
                      } catch (cause) {
                        setError(String(cause));
                      }
                    }}
                  >
                    Continue in a new chat
                  </Button>
                </div>
              )}
              {questions.map((prompt) => (
                <AgentQuestion
                  key={prompt.id}
                  prompt={prompt}
                  active
                  onAnswer={async (answer) => {
                    if (!active) throw new Error('This attempt is no longer running.');
                    await respondToPrompt(active.id, prompt.id, answer);
                    await refresh();
                  }}
                />
              ))}
            </div>
          )}
          <SessionComposer
            key={session.id}
            session={session}
            onSent={refresh}
            active={active}
            latestRun={latest}
            addition={addition}
          />
        </div>
        {tab !== 'conversation' && (
          <section className="live-work" aria-label="Conversation view">
            {tab === 'screen' &&
              (screenRun ? (
                <AgentScreen run={screenRun} />
              ) : (
                <p className="live-muted">
                  The agent’s browser and any window you let it control appear here once work
                  starts.
                </p>
              ))}
            {tab === 'terminal' &&
              (latest ? (
                <Suspense fallback={<p>Loading terminal…</p>}>
                  <TaskTerminal run={latest} />
                </Suspense>
              ) : (
                <p>A terminal is available after this conversation creates a workspace.</p>
              ))}
            {tab === 'changes' &&
              (active ? (
                <p className="live-muted">Finish or stop work to review the current changes.</p>
              ) : latest && (review || integrated) ? (
                <ResultReview
                  canApprove={session.paused && !active && !pending && !integrated}
                  key={latest.id}
                  run={latest}
                  review={review ?? undefined}
                  unavailable={
                    integrated ? (
                      <p className="live-muted">The applied patch is saved in the merge receipt.</p>
                    ) : undefined
                  }
                  onRefresh={showReview}
                  onCorrect={session.closed ? undefined : append}
                  evidence={
                    review && <CopyButton text={review.patchPath} label="Copy patch path" />
                  }
                  delivery={
                    <>
                      {project &&
                        (session.paused || integrated) &&
                        (pending ? (
                          <InlineNotice>
                            Run or cancel queued messages before merging this conversation.
                          </InlineNotice>
                        ) : (
                          <MergeReview
                            key={`merge:${latest.id}`}
                            project={project}
                            runs={runs}
                            items={[]}
                            merged={session.integratedRunId ? [session.integratedRunId] : []}
                            onlyRunId={latest.id}
                            changesReviewed={!integrated && !!review}
                            onChanged={refresh}
                          />
                        ))}
                      <TaskDelivery
                        run={latest}
                        integrated={integrated}
                        onHandoff={integrated ? nextChat : append}
                      />
                      <TaskLearning run={latest} allowSave />
                    </>
                  }
                />
              ) : latest ? (
                <Button variant="outline" disabled={busy} onClick={showReview}>
                  Load current changes
                </Button>
              ) : (
                <p className="live-muted">No changes yet.</p>
              ))}
            {tab === 'preview' &&
              (integrated ? (
                <p className="live-muted">
                  This result is integrated. Continue in a new chat to preview further changes.
                </p>
              ) : latest && !active ? (
                <TaskPreview
                  key={latest.id}
                  run={latest}
                  onFeedback={session.closed ? undefined : append}
                />
              ) : (
                <p className="live-muted">
                  {active
                    ? 'Finish or stop work to start a preview.'
                    : 'Run a change to start a preview.'}
                </p>
              ))}
          </section>
        )}
      </div>
    </section>
  );
}

/** Says who sent a message the person did not type: a wake-up or another bot. */
function MessageOriginLabel({
  origin,
  onOpenSession,
}: {
  origin: MessageOrigin;
  onOpenSession?: (id: string) => void;
}) {
  const sender = useBotStore((state) => state.bots.find((bot) => bot.id === origin.botId));
  return (
    <span className="live-author live-origin">
      {origin.kind === 'wake' ? (
        <AlarmClock size={14} aria-hidden="true" />
      ) : (
        <BotAvatar appearance={sender?.appearance} agent={sender?.agent} />
      )}
      <span>{origin.kind === 'wake' ? `Woke up · ${origin.label}` : origin.label}</span>
      {origin.sessionId && onOpenSession && origin.kind !== 'wake' && (
        <button
          type="button"
          className="live-origin-link"
          onClick={() => onOpenSession(origin.sessionId ?? '')}
        >
          Open {origin.botName ?? 'their'} conversation
        </button>
      )}
    </span>
  );
}
