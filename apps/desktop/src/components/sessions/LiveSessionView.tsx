import { AgentCharacter } from '@jackalope/brand/agent-character';
import { CopyButton } from '@jackalope/ui';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Minus,
  PanelRightClose,
  Pin,
  X,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  type LiveSession,
  type SessionReview,
  sessionCommand,
  sessionRunNeedsAttention,
  sessionWork,
} from '../../lib/live-session';
import { isActive, nativeTask, respondToPrompt, type TaskRun } from '../../lib/task-runtime';
import { isTauriEnvironment, openExternalUrl } from '../../lib/tauri-bridge';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { AgentQuestion } from '../tasks/AgentQuestion';
import { TaskPreview } from '../tasks/TaskPreview';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Tooltip } from '../ui/Tooltip';
import { SessionComposer } from './SessionComposer';
import { SessionRecovery } from './SessionRecovery';
import './live-session.css';

const TaskMarkdown = lazy(() => import('../tasks/TaskMarkdown'));
const RichDiff = lazy(() => import('../tasks/RichDiff'));

export function LiveSessionView({
  session,
  runs,
  detached = false,
  onBack,
  initialDetailsOpen = !detached,
}: {
  session: LiveSession;
  runs: TaskRun[];
  detached?: boolean;
  onBack?: () => void;
  initialDetailsOpen?: boolean;
}) {
  const { active, latest, pending, questions, status } = sessionWork(session, runs);
  const [expanded, setExpanded] = useState(initialDetailsOpen);
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<'work' | 'changes' | 'preview'>('work');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<SessionReview | null>(null);
  const reviewAttempt = useRef('');
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const refresh = () => useLiveSessionStore.getState().refresh(session.id);
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
  const showReview = () => {
    setExpanded(true);
    setTab('changes');
    if (!latest || active) return;
    void act(async () => {
      await sessionCommand('action', { id: session.id, action: 'pause' });
      reviewAttempt.current = `${latest.id}:${latest.status}:true`;
      setReview(await sessionCommand<SessionReview>('review', { id: session.id }));
    });
  };
  const provider = active?.agent ?? latest?.agent ?? session.request.agent;
  const tools = (
    <>
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
      {detached && (
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
  return (
    <section
      className={`live-session${detached ? ' live-session-detached' : ''}`}
      aria-label={session.title}
    >
      <header className="live-header" data-tauri-drag-region={detached || undefined}>
        {!detached && onBack && (
          <Button variant="ghost" size="icon" aria-label="Back to sessions" onClick={onBack}>
            <ArrowLeft size={18} />
          </Button>
        )}
        <span className="live-mascot" aria-hidden="true">
          <AgentCharacter
            provider={provider}
            state={questions.length ? 'waiting' : active ? 'working' : 'idle'}
          />
        </span>
        <div className="live-title" data-tauri-drag-region={detached || undefined}>
          <h1 data-tauri-drag-region={detached || undefined}>{session.title}</h1>
          <span className="live-muted" data-tauri-drag-region={detached || undefined}>
            {session.request.projectName}
          </span>
        </div>
        <div className="app-titlebar-controls">{tools}</div>
      </header>
      <SessionRecovery />
      <div className="live-statusbar">
        <button
          type="button"
          className="live-status"
          aria-expanded={expanded}
          aria-controls="live-session-work"
          onClick={() => setExpanded(!expanded)}
        >
          <span aria-live="polite">
            {status === 'Queued' ? `${pending} queued` : status}
            {pending && status !== 'Queued' ? ` · ${pending} queued` : ''}
          </span>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {detached ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={collapsed ? 'Expand conversation' : 'Collapse conversation'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </Button>
        ) : (
          <Button variant="ghost" disabled={!latest || !!active || busy} onClick={showReview}>
            Review changes
          </Button>
        )}
      </div>
      {(error || session.error) && (
        <div className="live-notice">
          <InlineNotice tone="error">{error || session.error}</InlineNotice>
        </div>
      )}
      <div className="live-columns" data-expanded={expanded}>
        <div className="live-conversation">
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
                const batch = session.batches.find((batch) => batch.runId === message.runId);
                const run = runs.find((run) => run.id === message.runId);
                const lastInBatch = batch?.messageIds.at(-1) === message.id;
                return (
                  <div key={message.id}>
                    <article className="live-message" data-canceled={message.canceled || undefined}>
                      <span className="live-author">You</span>
                      <p>{message.text}</p>
                      <div className="live-receipt">
                        {message.canceled
                          ? 'Canceled'
                          : run
                            ? isActive(run)
                              ? 'Working'
                              : sessionRunNeedsAttention(run)
                                ? 'Needs attention'
                                : 'Handled'
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
                      </div>
                    </article>
                    {lastInBatch && run?.result && (
                      <article className="live-message live-reply">
                        <span className="live-mascot">
                          <AgentCharacter
                            provider={run.agent}
                            state={isActive(run) ? 'working' : 'idle'}
                          />
                        </span>
                        <div>
                          <span className="live-author">
                            {run.agent === 'auto' ? 'Jackalope' : run.agent}
                          </span>
                          <Suspense fallback={<p>{run.result}</p>}>
                            <TaskMarkdown
                              content={run.result}
                              active={isActive(run)}
                              onOpenLink={(url) => void act(() => openExternalUrl(url))}
                            />
                          </Suspense>
                        </div>
                      </article>
                    )}
                  </div>
                );
              })}
              {active && !active.result && (
                <div className="live-working">
                  <span className="live-mascot">
                    <AgentCharacter
                      provider={active.agent}
                      state={questions.length ? 'waiting' : 'working'}
                    />
                  </span>
                  <span className="live-muted">
                    {active.finishing
                      ? 'Checking changes'
                      : active.progress?.label ||
                        (active.status === 'starting' ? 'Preparing workspace' : 'Working')}
                  </span>
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
          <SessionComposer key={session.id} session={session} onSent={refresh} />
        </div>
        {expanded && (
          <aside className="live-work" id="live-session-work">
            <fieldset className="live-tabs" aria-label="Session details">
              {(['work', 'changes', 'preview'] as const).map((value) => (
                <Button
                  key={value}
                  variant="ghost"
                  aria-pressed={tab === value}
                  onClick={() => {
                    if (value === 'changes') showReview();
                    else {
                      setTab(value);
                      if (value === 'preview')
                        void act(() =>
                          sessionCommand('action', { id: session.id, action: 'pause' }),
                        );
                    }
                  }}
                >
                  {value === 'work' ? 'Work' : value === 'changes' ? 'Changes' : 'Preview'}
                </Button>
              ))}
            </fieldset>
            {tab === 'work' && (
              <>
                <div className="live-work-list">
                  {session.batches.map((batch, index) => {
                    const run = runs.find((r) => r.id === batch.runId);
                    const message = session.messages.find((m) => batch.messageIds.includes(m.id));
                    return (
                      <div className="live-work-row" key={batch.runId}>
                        <span className="live-mascot">
                          <AgentCharacter
                            provider={run?.agent ?? session.request.agent}
                            state={run && isActive(run) ? 'working' : 'idle'}
                          />
                        </span>
                        <div>
                          <p>{message?.text.split('\n')[0] || `Batch ${index + 1}`}</p>
                          <span className="live-muted">
                            {run?.finishing
                              ? 'Checking'
                              : run && isActive(run)
                                ? 'Working'
                                : batch.error
                                  ? 'Needs attention'
                                  : run?.status === 'review'
                                    ? 'Ready to review'
                                    : (run?.status ?? 'Queued')}{' '}
                            · {batch.messageIds.length}{' '}
                            {batch.messageIds.length === 1 ? 'message' : 'messages'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="live-work-actions">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        sessionCommand('action', {
                          id: session.id,
                          action: session.paused || session.closed ? 'resume' : 'pause',
                        }),
                      )
                    }
                  >
                    {session.closed
                      ? 'Reopen session'
                      : session.paused
                        ? 'Resume queue'
                        : 'Pause queue'}
                  </Button>
                  {active && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await sessionCommand('action', { id: session.id, action: 'pause' });
                          await nativeTask('task_stop', { id: active.id });
                        })
                      }
                    >
                      Stop work
                    </Button>
                  )}
                  {!active && session.batches.at(-1)?.error && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          sessionCommand('action', { id: session.id, action: 'retry' }),
                        )
                      }
                    >
                      Retry launch
                    </Button>
                  )}
                  {!active && !session.closed && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void act(() =>
                          sessionCommand('action', { id: session.id, action: 'finish' }),
                        )
                      }
                    >
                      Finish session
                    </Button>
                  )}
                </div>
              </>
            )}
            {tab === 'changes' &&
              (active ? (
                <p className="live-muted">Finish or stop work to review the current changes.</p>
              ) : review ? (
                <>
                  <div className="live-review-meta">
                    <span>
                      {review.files.length} {review.files.length === 1 ? 'file' : 'files'} ·{' '}
                      {review.verified ? 'Checks passed' : 'Not verified'}
                    </span>
                    <CopyButton text={review.patchPath} label="Copy patch path" />
                  </div>
                  <p className="live-muted">Dispatch paused. Changes remain uncommitted.</p>
                  {review.note && <p className="live-muted">{review.note}</p>}
                  <Suspense fallback={<p>Loading diff…</p>}>
                    <RichDiff patch={review.diff} />
                  </Suspense>
                </>
              ) : (
                <p className="live-muted">{latest ? 'Loading changes…' : 'No changes yet.'}</p>
              ))}
            {tab === 'preview' &&
              (latest && !active ? (
                <TaskPreview run={latest} />
              ) : (
                <p className="live-muted">
                  {active
                    ? 'Finish or stop work to start a preview.'
                    : 'Run a change to start a preview.'}
                </p>
              ))}
            {latest?.workspace && (
              <details className="live-workspace">
                <summary>Workspace</summary>
                <p>{latest.workspace}</p>
                <CopyButton text={latest.workspace} label="Copy path" />
                <p>{latest.branch}</p>
              </details>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
