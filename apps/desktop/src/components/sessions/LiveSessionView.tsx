import { AgentCharacter } from '@jackalope/brand/agent-character';
import { isActive } from '@jackalope/contracts/runs';
import { Button, CopyButton, InlineNotice, SegmentedControl, Tooltip } from '@jackalope/ui';
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
import { copyText } from '../../lib/clipboard';
import { deviceSupport } from '../../lib/devices';
import {
  type LiveSession,
  type MessageOrigin,
  type SessionMessage,
  type SessionReview,
  sessionCommand,
  sessionRunNeedsAttention,
  sessionWork,
} from '../../lib/live-session';
import { isTauriEnvironment, openExternalUrl } from '../../lib/native/env';
import { groupRewound, isRewound } from '../../lib/rewind';
import type { TaskRun } from '../../lib/run-types';
import { sessionMarkdown } from '../../lib/session-export';
import { replyOmitted } from '../../lib/session-replies';
import { respondToPrompt, stopTask } from '../../lib/task-client';
import { taskDecision } from '../../lib/task-workflow';
import { usageLimitOf } from '../../lib/usage-limit';
import { openImportedConversation, selectWork } from '../../lib/work-selection';
import { BOT_COLORS, useBotStore } from '../../stores/botStore';
import { useImportedConversationStore } from '../../stores/importedConversationStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useProjectStore } from '../../stores/projectStore';
import { useChangeStats } from '../../stores/workSignalsStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { BotAvatar, botStyle } from '../bots/BotAvatar';
import { BotCardView } from '../bots/BotCardView';
import { TaskLearning } from '../knowledge/TaskLearning';
import { AgentQuestion } from '../tasks/AgentQuestion';
import { AgentScreen } from '../tasks/AgentScreen';
import { DecisionTrail } from '../tasks/DecisionTrail';
import { DesktopPermissionNotice } from '../tasks/DesktopPermissionNotice';
import { EditFromHereButton, RewindUndoNotice, RewoundTurns } from '../tasks/EditFromHere';
import { MergeReview } from '../tasks/MergeReview';
import { ResultReview } from '../tasks/ResultReview';
import { deliveryHandoff, TaskDelivery } from '../tasks/TaskDelivery';
import { TaskLiveActivity } from '../tasks/TaskLiveActivity';
import { TaskPreview } from '../tasks/TaskPreview';
import { limitBannerDismissed, UsageLimitBanner } from '../tasks/UsageLimitBanner';
import { useWorkSeen, WorkContextDetails } from '../tasks/WorkContext';
import { WorkFeedbackInbox } from '../tasks/WorkFeedbackInbox';
import { WorkSourceLink } from '../tasks/WorkSourceLink';
import { isPopOutPane, PopOutButton, useWorkspaceActions } from '../tasks/WorkTools';
import { ChatOptions } from './ChatOptions';
import { DevicePanel } from './DevicePanel';
import { ReadAloudButton } from './ReadAloudButton';
import { SessionComposer } from './SessionComposer';
import { SessionLimits } from './SessionLimits';
import { SessionRecovery } from './SessionRecovery';
import { SessionTopics } from './SessionTopics';
import { Transcript, type TranscriptHandle, type TranscriptRow } from './Transcript';
import { TranscriptResult } from './TranscriptResult';
import { WindowGlob } from './WindowGlob';
import './live-session.css';
import { describeError } from '@jackalope/contracts/errors';
import { useAction } from '../../hooks/useAction';

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
  const imported = useImportedConversationStore((state) =>
    state.conversations.find((conversation) => conversation.continuedIn === session.id),
  );
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
  // One row per message, carrying the reply that finished its batch. Consecutive rewound
  // turns share one collapsed row that find leaves out: their work was undone.
  const { entries, rows, items } = useMemo(() => {
    let items = 0;
    const entries: { rewound: boolean; messages: SessionMessage[] }[] = [];
    const rows: TranscriptRow[] = [];
    const sizeOf = (message: SessionMessage) => {
      const run = message.runId ? runById.get(message.runId) : undefined;
      const batch = message.runId ? batchById.get(message.runId) : undefined;
      const last = batch?.messageIds.at(-1) === message.id;
      const omitted = last && replyOmitted(run);
      const reply = last && !omitted ? (run?.result ?? '') : '';
      const length = omitted ? (run?.resultChars ?? 0) : reply.length;
      items += reply || omitted ? 2 : 1;
      return {
        text: [message.text, omitted ? null : reply],
        estimate:
          70 +
          Math.ceil(message.text.length / 70) * 22 +
          (length ? 90 + Math.ceil(length / 90) * 22 : 0),
      };
    };
    for (const group of groupRewound(session.messages, (message) =>
      isRewound(message.runId ? runById.get(message.runId) : undefined),
    )) {
      if (group.rewound) {
        // Still counted, so turns an Undo brings back are not new on Jump to latest.
        for (const message of group.items) sizeOf(message);
        entries.push({ rewound: true, messages: group.items });
        rows.push({ key: `rewound:${group.items[0].id}`, text: [], estimate: 56 });
        continue;
      }
      for (const message of group.items) {
        entries.push({ rewound: false, messages: [message] });
        rows.push({ key: message.id, ...sizeOf(message) });
      }
    }
    return { entries, rows, items };
  }, [session.messages, runById, batchById]);
  // Expanded rewound groups by row key: rows unmount as they scroll away.
  const [openRewound, setOpenRewound] = useState<ReadonlySet<string>>(() => new Set());
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
  const { run: act, busy, error, setError } = useAction(() => refresh());
  const [review, setReview] = useState<SessionReview | null>(null);
  const reviewAttempt = useRef('');
  const transcript = useRef<TranscriptHandle>(null);
  // Replies already formatted render formatted again when they scroll back into view.
  const formatted = useRef(new Set<string>());
  // Older replies the snapshot left out load together as their rows render.
  // A failed load keeps its rows' ids, so the row and the banner can retry, and a row
  // that renders again tries once more on its own.
  const [replyFailure, setReplyFailure] = useState<{ error: string; ids: string[] } | null>(null);
  const requested = useRef(new Set<string>());
  const requestReply = (runId: string) => {
    const batch = requested.current;
    batch.add(runId);
    if (batch.size > 1) return;
    queueMicrotask(() => {
      const ids = [...batch];
      batch.clear();
      useLiveSessionStore
        .getState()
        .loadReplies(session.id, ids)
        .then(
          () =>
            setReplyFailure((failure) => {
              const left = failure?.ids.filter((id) => !ids.includes(id)) ?? [];
              return failure && left.length ? { ...failure, ids: left } : null;
            }),
          (cause) =>
            setReplyFailure((failure) => ({
              error: describeError(cause),
              ids: [...new Set([...(failure?.ids ?? []), ...ids])],
            })),
        );
    });
  };
  const retryReplies = () => {
    for (const id of replyFailure?.ids ?? []) requestReply(id);
  };
  const replyError = replyFailure?.error ?? '';
  const searchUnloaded = async (query: string) =>
    new Map(
      Object.entries(await useLiveSessionStore.getState().searchReplies(session.id, query)).flatMap(
        ([runId, count]) => {
          const batch = batchById.get(runId);
          const message = batch?.messageIds.at(-1);
          return message ? [[message, count] as const] : [];
        },
      ),
    );
  const mascotRef = useRef<HTMLSpanElement>(null);
  const mascotGaze = useAgentGaze(mascotRef);
  const refresh = () => useLiveSessionStore.getState().refresh(session.id);
  const tooled = !detached && !simple;
  useWorkSeen(tooled ? latest : undefined);
  const workspace = useWorkspaceActions(tooled ? latest : undefined);
  // Offered on a Mac with Xcode when the conversation's workspace has an Xcode project.
  const [devices, setDevices] = useState(false);
  const deviceWorkspace = latest?.workspace ?? session.request.projectPath;
  useEffect(() => {
    if (!isTauriEnvironment() || !/Mac/.test(navigator.platform)) return;
    let current = true;
    void deviceSupport(deviceWorkspace)
      .then((support) => current && setDevices(support.supported && support.xcodeProject))
      .catch(() => current && setDevices(false));
    return () => {
      current = false;
    };
  }, [deviceWorkspace]);
  useEffect(() => {
    const attempt = `${latest?.id}:${latest?.status}:${session.paused}`;
    if (reviewAttempt.current !== attempt) {
      reviewAttempt.current = attempt;
      setReview(null);
    }
  }, [latest?.id, latest?.status, session.paused]);
  const windowAction = async (action: 'minimize' | 'close') => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow()[action]();
    } catch (cause) {
      setError(describeError(cause));
    }
  };
  const changeStats = useChangeStats([latest]);
  const latestChanges = latest ? changeStats[latest.id]?.value : undefined;
  // Review holds queued messages so the diff stays put; leaving Review lets them run again
  // when Review was what paused the conversation.
  const pausedForReview = useRef(false);
  const showReview = () => {
    setTab('changes');
    if (!latest || active || integrated) return;
    if (!session.paused) pausedForReview.current = true;
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
  const togglePause = () => {
    // A choice made here wins over the pause Review applied.
    pausedForReview.current = false;
    void act(() =>
      sessionCommand('action', {
        id: session.id,
        action: session.paused || session.closed ? 'resume' : 'pause',
      }),
    );
  };
  const stopWork = () =>
    void act(async () => {
      if (!active) return;
      await sessionCommand('action', { id: session.id, action: 'pause' });
      await stopTask(active.id);
    });
  const retryable = !active && !!session.batches.at(-1)?.error;
  // A usage limit that paused the conversation gets its own banner, until the person
  // resumes it, sends it on or dismisses the banner.
  const latestLimit = useMemo(() => usageLimitOf(latest), [latest]);
  const sessionLimit =
    latestLimit && latest && session.paused && !session.closed && !active && !integrated
      ? { limit: latestLimit, runId: latest.id }
      : null;
  const [limitHidden, setLimitHidden] = useState(false);
  useEffect(() => setLimitHidden(!!latest && limitBannerDismissed(latest.id)), [latest]);
  const tools = (
    <>
      {(!detached || (!integrated && !simple)) && (
        <ChatOptions
          actions={
            detached
              ? []
              : [
                  ...(workspace.editor ? [workspace.editor] : []),
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
                  ...(session.messages.length
                    ? [
                        {
                          id: 'copy-conversation',
                          label: 'Copy conversation as Markdown',
                          onSelect: () =>
                            void act(() =>
                              copyText(
                                async () => {
                                  const store = useLiveSessionStore.getState();
                                  await store.loadAllReplies(session.id);
                                  return sessionMarkdown(
                                    session,
                                    useLiveSessionStore.getState().runs,
                                    latest?.agent && latest.agent !== 'auto'
                                      ? latest.agent
                                      : 'Jackalope',
                                  );
                                },
                                session.batches.some((batch) =>
                                  replyOmitted(runById.get(batch.runId)),
                                ),
                              ),
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
            workspace.more.length
              ? [{ id: 'open-in', label: 'Open in…', groups: [workspace.more] }]
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
            ...(devices
              ? [
                  {
                    id: 'device',
                    label: 'iPhone or iPad',
                    content: () => (
                      <DevicePanel
                        conversation={session.id}
                        projectId={session.request.projectId}
                        projectName={session.request.projectName}
                        runId={latest?.id}
                      />
                    ),
                  },
                ]
              : []),
          ].filter(
            (item) => item.id === 'context' || item.id === 'device' || (!integrated && !simple),
          )}
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
      {/* Only once the work changed files: an answer or a report has nothing to review. */}
      {!simple &&
        latest &&
        !active &&
        !integrated &&
        tab !== 'changes' &&
        !!latestChanges?.files && (
          <Button disabled={busy} onClick={showReview}>
            Review changes
          </Button>
        )}
    </>
  );
  /** After a rewind: the turn's messages go back into the composer, below any draft. */
  const rewound = async ({ prompt }: { prompt: string }) => {
    await refresh();
    await append(prompt);
  };
  /** `searchable` is false inside a rewound group, whose text find leaves out. */
  const renderMessage = (message: SessionMessage, searchable = true) => {
    const batch = message.runId ? batchById.get(message.runId) : undefined;
    const run = message.runId ? runById.get(message.runId) : undefined;
    const lastInBatch = batch?.messageIds.at(-1) === message.id;
    const origin = message.origin;
    const incoming = origin && origin.kind !== 'card';
    return (
      <>
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
          <p data-find-part={searchable ? 0 : undefined}>{message.text}</p>
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
            <MessageTime at={message.createdAt} />
            <CopyButton className="live-copy" size="sm" text={message.text} label="Copy" />
            {run && batch?.messageIds[0] === message.id && !integrated && !session.closed && (
              <EditFromHereButton runs={runs} run={run} onRewound={rewound} />
            )}
          </div>
        </article>
        {lastInBatch && run && (run.result || replyOmitted(run)) && (
          <article className="live-message live-reply">
            <span className="live-mascot">
              <AgentCharacter
                provider={character(run.agent)}
                state={isActive(run) ? 'working' : 'idle'}
              />
            </span>
            <div>
              <span className="live-author">
                {session.persona?.name ?? (run.agent === 'auto' ? 'Jackalope' : run.agent)}
              </span>
              <div data-find-part={searchable ? 1 : undefined}>
                {replyOmitted(run) ? (
                  <OmittedReply
                    chars={run.resultChars ?? 0}
                    failed={!!replyFailure?.ids.includes(run.id)}
                    onLoad={() => requestReply(run.id)}
                  />
                ) : (
                  <Suspense fallback={<p>{run.result}</p>}>
                    <TranscriptResult
                      recent={recentBatches.has(run.id) || formatted.current.has(run.id)}
                      onFormatted={() => formatted.current.add(run.id)}
                      content={run.result}
                      active={isActive(run)}
                      onOpenLink={(url) => void act(() => openExternalUrl(url))}
                    />
                  </Suspense>
                )}
              </div>
              {!isActive(run) && !!run.result && (
                <div className="live-receipt">
                  {run.endedAt && <MessageTime at={run.endedAt} />}
                  <CopyButton
                    className="live-copy"
                    size="sm"
                    text={run.result}
                    label="Copy reply"
                  />
                  <ReadAloudButton className="live-copy" text={run.result} />
                </div>
              )}
            </div>
          </article>
        )}
        {lastInBatch && run && !!run.decisions?.length && (
          <div className="live-card live-trail">
            <DecisionTrail attempts={[run]} />
          </div>
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
                Changed {latestChanges.files} {latestChanges.files === 1 ? 'file' : 'files'}
                <small>
                  +{latestChanges.added} −{latestChanges.removed}
                </small>
              </span>
              <Button disabled={busy} onClick={showReview}>
                Review changes
              </Button>
            </div>
          )}
      </>
    );
  };
  return (
    <section
      className={`live-session${detached ? ' live-session-detached' : ''}`}
      data-transcript-scope
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
        <WindowGlob
          conversation={session.id}
          provider={provider}
          agent="Jackalope"
          disabled={session.closed}
          mascotRef={mascotRef}
          onAttached={append}
        >
          <AgentCharacter
            provider={provider}
            state={questions.length ? 'waiting' : active ? 'working' : 'idle'}
            gaze={mascotGaze}
          />
        </WindowGlob>
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
      {imported && !detached && (
        <div className="live-notice">
          <InlineNotice
            action={
              <Button
                variant="outline"
                onClick={() => openImportedConversation(imported.id, imported.projectId)}
              >
                Earlier messages
              </Button>
            }
          >
            This continues a {imported.agentName} conversation imported into Jackalope.
          </InlineNotice>
        </div>
      )}
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
      ) : sessionLimit && !limitHidden ? (
        <div className="live-notice">
          <UsageLimitBanner
            runId={sessionLimit.runId}
            limit={sessionLimit.limit}
            scheduledAt={session.resumeAtReset ? session.resumeAtReset.at * 1000 : null}
            onResumeAtReset={
              detached
                ? undefined
                : () =>
                    void act(() =>
                      sessionCommand('action', { id: session.id, action: 'resume-at-reset' }),
                    )
            }
            onCancelResume={
              session.resumeAtReset
                ? () =>
                    void act(() =>
                      sessionCommand('action', {
                        id: session.id,
                        action: 'cancel-resume-at-reset',
                      }),
                    )
                : undefined
            }
            onDismiss={() => setLimitHidden(true)}
            busy={busy}
            error={error}
          />
        </div>
      ) : (
        (error || workspace.error || session.error || replyError || retryable) && (
          <div className="live-notice">
            <InlineNotice
              tone="error"
              action={
                retryable && !error && !workspace.error && !session.error && !replyError ? (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void act(() => sessionCommand('action', { id: session.id, action: 'retry' }))
                    }
                  >
                    Retry launch
                  </Button>
                ) : (
                  !error &&
                  !workspace.error &&
                  !session.error &&
                  replyError && (
                    <Button variant="outline" onClick={retryReplies}>
                      Retry loading replies
                    </Button>
                  )
                )
              }
            >
              {error ||
                workspace.error ||
                session.error ||
                replyError ||
                session.batches.at(-1)?.error}
            </InlineNotice>
          </div>
        )
      )}
      {latest && !integrated && (
        <RewindUndoNotice
          className="live-notice"
          runs={runs}
          taskId={latest.taskId}
          onChanged={refresh}
        />
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
                if (pausedForReview.current && value !== 'preview') {
                  pausedForReview.current = false;
                  void act(() => sessionCommand('action', { id: session.id, action: 'resume' }));
                }
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
          {/* A conversation pops out its review, preview and terminal; the transcript stays. */}
          {workspace.popOut && tab !== 'conversation' && isPopOutPane(tab) && (
            <PopOutButton pane={tab} onPopOut={workspace.popOut} />
          )}
        </div>
      )}
      <div className="live-columns">
        <div className="live-conversation" hidden={tab !== 'conversation'}>
          {!collapsed && (
            <Transcript
              handle={transcript}
              className="live-transcript"
              label="conversation"
              rows={rows}
              items={items}
              searchUnloaded={searchUnloaded}
              renderRow={(index) => {
                const entry = entries[index];
                const key = rows[index].key;
                return entry.rewound ? (
                  <RewoundTurns
                    count={new Set(entry.messages.map((item) => item.runId)).size}
                    open={openRewound.has(key)}
                    onOpenChange={(open) =>
                      setOpenRewound((keys) => {
                        if (keys.has(key) === open) return keys;
                        const next = new Set(keys);
                        if (open) next.add(key);
                        else next.delete(key);
                        return next;
                      })
                    }
                  >
                    {entry.messages.map((message) => (
                      <div key={message.id}>{renderMessage(message, false)}</div>
                    ))}
                  </RewoundTurns>
                ) : (
                  renderMessage(entry.messages[0])
                );
              }}
              before={
                !session.messages.length && (
                  <div className="live-empty">
                    <span className="live-mascot">
                      <AgentCharacter provider={provider} />
                    </span>
                  </div>
                )
              }
              after={
                <>
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
                            setError(describeError(cause));
                          }
                        }}
                      >
                        Continue in a new chat
                      </Button>
                    </div>
                  )}
                  {latest && <DesktopPermissionNotice key={latest.id} run={latest} />}
                  {questions.map((prompt, index) => (
                    <AgentQuestion
                      key={prompt.id}
                      prompt={prompt}
                      active
                      highlight={index === 0}
                      onAnswer={async (answer) => {
                        if (!active) throw new Error('This attempt is no longer running.');
                        await respondToPrompt(active.id, prompt.id, answer);
                        await refresh();
                      }}
                    />
                  ))}
                </>
              }
            />
          )}
          <SessionComposer
            key={session.id}
            session={session}
            onSent={() => {
              transcript.current?.scrollToLatest();
              return refresh();
            }}
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
                        onFollowUp={session.closed ? undefined : append}
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
      {origin.kind === 'wake' || origin.kind === 'resume' ? (
        <AlarmClock size={14} aria-hidden="true" />
      ) : (
        <BotAvatar appearance={sender?.appearance} agent={sender?.agent} />
      )}
      <span>{origin.kind === 'wake' ? `Woke up · ${origin.label}` : origin.label}</span>
      {origin.sessionId && onOpenSession && origin.kind === 'bot' && (
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

/**
 * When a message was sent or a reply arrived, revealed with Copy on hover or focus: the
 * time today, and the date as well on earlier days.
 */
function MessageTime({ at }: { at: string }) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const label =
    date.toDateString() === now.toDateString()
      ? time
      : `${date.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
        })}, ${time}`;
  return (
    <time className="live-time" dateTime={at} title={date.toLocaleString()}>
      {label}
    </time>
  );
}

/** A reply the snapshot left out: holds its expected height and loads once rendered. */
function OmittedReply({
  chars,
  failed,
  onLoad,
}: {
  chars: number;
  failed: boolean;
  onLoad: () => void;
}) {
  const load = useRef(onLoad);
  load.current = onLoad;
  useEffect(() => load.current(), []);
  const height = Math.min(2000, Math.ceil(chars / 90) * 22);
  return failed ? (
    <p className="live-muted live-reply-failed" style={{ minHeight: height }}>
      <span>This reply could not be loaded.</span>
      <Button variant="outline" size="sm" onClick={() => load.current()}>
        Retry
      </Button>
    </p>
  ) : (
    // Not a live region: every older reply scrolling past would be announced.
    <p className="live-muted" aria-busy="true" style={{ minHeight: height }}>
      Loading reply…
    </p>
  );
}
