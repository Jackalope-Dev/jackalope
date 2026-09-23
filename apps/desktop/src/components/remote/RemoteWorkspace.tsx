import {
  Button,
  Disclosure,
  DisclosureSummary,
  FormField,
  Select,
  SelectItem,
  Textarea,
} from '@jackalope/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { prepareRemoteRequest } from '../../lib/remote-request';
import type { PendingUserPrompt, Review } from '../../lib/task-runtime';
import { AgentQuestion } from '../tasks/AgentQuestion';
import { ChangedFiles } from '../tasks/ChangedFiles';
import { InlineNotice } from '../ui/InlineNotice';
import './remote.css';

export interface RemoteAction {
  action: string;
  id?: string;
  projectId?: string;
  runId?: string;
  sessionId?: string;
  promptId?: string;
  text?: string;
}
export type RemoteRequest = <T>(action: RemoteAction) => Promise<T>;
interface RemoteTask {
  id: string;
  taskId: string;
  sessionId: string | null;
  projectId: string;
  projectName: string;
  title: string;
  status: string;
  result: string;
  error: string | null;
  startedAt: string;
  prompts: PendingUserPrompt[];
  activity: string[];
}
interface RemoteSession {
  id: string;
  title: string;
  projectId: string;
  paused: boolean;
  error: string | null;
  pending: number;
}
interface Snapshot {
  projects: { id: string; name: string }[];
  tasks: RemoteTask[];
  sessions: RemoteSession[];
}

function active(task: RemoteTask) {
  return ['starting', 'running', 'stopping'].includes(task.status);
}

export function RemoteWorkspace({
  request,
  storageKey,
}: {
  request: RemoteRequest;
  storageKey: string;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<RemoteTask | null>(null);
  const [projectId, setProjectId] = useState('');
  const [loadedReview, setReview] = useState<{ runId: string; value: Review } | null>(null);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [status, setStatus] = useState('Connecting…');
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const inFlight = useRef(false);
  const revision = useRef(0);
  const selectedSession = snapshot?.sessions.find((s) => s.id === selected);
  const latestTasks = [
    ...new Map(
      [...(snapshot?.tasks ?? [])].reverse().map((task) => [task.sessionId || task.taskId, task]),
    ).values(),
  ].reverse();
  const selectedTask = snapshot?.tasks.find((task) => (task.sessionId || task.taskId) === selected);
  const review = loadedReview?.runId === selectedTask?.id ? loadedReview?.value : null;
  const draftKey = `${storageKey}:draft:${composing ? 'new' : selected}`;
  const legacyDraftKey =
    selectedTask && !selectedTask.sessionId && !composing
      ? `${storageKey}:draft:${selectedTask.id}`
      : undefined;
  useEffect(() => {
    try {
      let saved = localStorage.getItem(draftKey);
      if (saved === null && legacyDraftKey) {
        const legacy = legacyDraftKey;
        saved = localStorage.getItem(legacy);
        if (saved !== null && legacy !== draftKey) {
          localStorage.setItem(draftKey, saved);
          const receipt = localStorage.getItem(`${legacy}:request`);
          if (receipt) localStorage.setItem(`${draftKey}:request`, receipt);
          localStorage.removeItem(legacy);
          localStorage.removeItem(`${legacy}:request`);
        }
      }
      setDraft(saved ?? '');
    } catch {
      setDraft('');
      setError('Draft storage is unavailable. Keep this view open until you send your message.');
    }
  }, [draftKey, legacyDraftKey]);
  const editDraft = (value: string) => {
    setDraft(value);
    try {
      if (value) localStorage.setItem(draftKey, value);
      else localStorage.removeItem(draftKey);
    } catch {
      setError('This draft could not be saved. Keep this view open until you send it.');
    }
  };
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    try {
      const next = await request<Snapshot>({ action: 'snapshot' });
      const run = next.tasks.find((task) => (task.sessionId || task.taskId) === selected);
      const loaded = run ? await request<RemoteTask>({ action: 'detail', runId: run.id }) : null;
      if (revision.current !== current) return;
      setSnapshot(next);
      setDetail(loaded);
      setStatus('Connected');
      setConnectionError('');
    } catch (cause) {
      if (revision.current === current) {
        setStatus('Disconnected');
        setConnectionError(String(cause));
      }
    }
  }, [request, selected]);
  useEffect(() => {
    let canceled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === 'visible') await refresh();
      if (!canceled) timer = setTimeout(poll, 4000);
    };
    void poll();
    return () => {
      canceled = true;
      clearTimeout(timer);
      revision.current++;
    };
  }, [refresh]);
  const act = async (action: RemoteAction) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await request(action);
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const submit = async () => {
    if (inFlight.current || !draft.trim()) return;
    const text = draft.trim();
    if (new TextEncoder().encode(text).length > 12000) {
      setError('Shorten this message to 12,000 bytes. Your draft is saved.');
      return;
    }
    let action: RemoteAction = composing
      ? { action: 'start', projectId: projectId || snapshot?.projects[0]?.id, text }
      : {
          action: 'followup',
          sessionId: selectedSession?.id || selectedTask?.sessionId || undefined,
          runId: selectedSession?.id || selectedTask?.sessionId ? undefined : selectedTask?.id,
          text,
        };
    try {
      action = prepareRemoteRequest(localStorage, `${draftKey}:request`, action);
    } catch {
      setError(
        'Could not save this send request. Free browser storage before retrying; nothing was sent.',
      );
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await request<{ sessionId?: string }>(action);
      editDraft('');
      try {
        localStorage.removeItem(`${draftKey}:request`);
      } catch {
        setError('Message sent. This browser could not clear its saved request.');
      }
      if (response.sessionId) {
        setSelected(response.sessionId);
        setComposing(false);
      }
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const choose = (id: string) => {
    if (inFlight.current) return;
    setSelected(id);
    setComposing(false);
    setReview(null);
    setDetail(null);
    setError('');
  };
  const currentDetail = detail && detail.id === selectedTask?.id ? detail : null;
  return (
    <section className="remote-workspace" aria-label="Remote tasks">
      <div className="remote-toolbar">
        <span role="status">{status}</span>
        <Button
          variant="outline"
          onClick={() => {
            setError('');
            void refresh();
          }}
        >
          Refresh
        </Button>
        <Button
          disabled={!snapshot?.projects.length || busy}
          onClick={() => {
            setComposing(true);
            setReview(null);
          }}
        >
          New task
        </Button>
      </div>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {connectionError && <InlineNotice tone="error">{connectionError}</InlineNotice>}
      <div className="remote-layout">
        <nav className="remote-task-list" aria-label="Host tasks">
          {snapshot?.sessions
            .filter((session) => !latestTasks.some((task) => task.sessionId === session.id))
            .map((session) => (
              <button
                type="button"
                key={session.id}
                aria-current={selected === session.id ? 'page' : undefined}
                onClick={() => choose(session.id)}
              >
                <strong>{session.title}</strong>
                <small>
                  {session.error ? 'Needs attention' : session.paused ? 'Paused' : 'Queued'}
                </small>
              </button>
            ))}
          {latestTasks.map((task) => (
            <button
              type="button"
              key={task.id}
              aria-current={selected === (task.sessionId || task.taskId) ? 'page' : undefined}
              onClick={() => choose(task.sessionId || task.taskId)}
            >
              <strong>{task.title}</strong>
              <small>
                {task.projectName} · {task.status}
              </small>
            </button>
          ))}
          {snapshot && !snapshot.tasks.length && !snapshot.sessions.length && (
            <p className="task-muted">No tasks yet.</p>
          )}
        </nav>
        <div className="remote-detail">
          {composing ? (
            <h2>New task</h2>
          ) : selectedTask || selectedSession ? (
            <>
              <h2>{selectedSession?.title || selectedTask?.title}</h2>
              {selectedSession?.error && (
                <InlineNotice tone="error">{selectedSession.error}</InlineNotice>
              )}
              {!!selectedSession?.pending && (
                <p role="status">
                  {selectedSession.pending} message{selectedSession.pending === 1 ? '' : 's'} queued
                  {selectedSession.paused ? ' · Paused' : ''}
                </p>
              )}
              <div className="remote-toolbar">
                {selectedTask && (
                  <Button
                    variant="outline"
                    disabled={busy || active(selectedTask)}
                    onClick={async () => {
                      if (inFlight.current) return;
                      inFlight.current = true;
                      setBusy(true);
                      setError('');
                      const runId = selectedTask.id;
                      try {
                        const next = await request<Review>({ action: 'review', runId });
                        setReview({ runId, value: next });
                        await refresh();
                      } catch (cause) {
                        setError(String(cause));
                      } finally {
                        inFlight.current = false;
                        setBusy(false);
                      }
                    }}
                  >
                    Review changes
                  </Button>
                )}
                {selectedSession && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void act({
                        action: selectedSession.paused ? 'resume' : 'pause',
                        sessionId: selectedSession.id,
                      })
                    }
                  >
                    {selectedSession.paused ? 'Resume' : 'Pause queue'}
                  </Button>
                )}
                {selectedTask && active(selectedTask) && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void act({ action: 'stop', runId: selectedTask.id })}
                  >
                    Stop task
                  </Button>
                )}
              </div>
              {currentDetail?.error && (
                <InlineNotice tone="error">{currentDetail.error}</InlineNotice>
              )}
              {currentDetail?.prompts
                .filter((prompt) => prompt.status === 'pending')
                .map((prompt) => (
                  <AgentQuestion
                    key={prompt.id}
                    prompt={prompt}
                    active={active(currentDetail)}
                    onAnswer={async (text) => {
                      await request({
                        action: 'answer',
                        runId: currentDetail.id,
                        promptId: prompt.id,
                        text,
                      });
                      await refresh();
                    }}
                  />
                ))}
              {review ? (
                <>
                  <Button variant="ghost" onClick={() => setReview(null)}>
                    Back to conversation
                  </Button>
                  <ChangedFiles files={review.files} patch={review.diff} />
                  <p className="task-muted">{review.note}</p>
                </>
              ) : (
                <>
                  {currentDetail?.result && (
                    <div className="remote-result task-markdown">
                      <ReactMarkdown
                        skipHtml
                        remarkPlugins={[remarkGfm]}
                        components={{
                          img: ({ alt }) => <span>{alt || 'Image'}</span>,
                          a: ({ href, children }) => (
                            <a
                              href={href?.startsWith('https://') ? href : undefined}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {currentDetail.result}
                      </ReactMarkdown>
                    </div>
                  )}
                  {!!currentDetail?.activity.length && (
                    <Disclosure>
                      <DisclosureSummary>Recent activity</DisclosureSummary>
                      <pre className="remote-result">{currentDetail.activity.join('\n')}</pre>
                    </Disclosure>
                  )}
                </>
              )}
            </>
          ) : (
            <p className="task-muted">Choose a task or start something new.</p>
          )}
          {!composing && selectedTask?.sessionId && !selectedSession && (
            <p className="task-muted">This chat is closed. Start a new task to continue.</p>
          )}
          {(composing || selectedSession || (selectedTask && !selectedTask.sessionId)) && (
            <form
              className="remote-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              {composing && (
                <FormField label="Project">
                  <Select
                    value={projectId || snapshot?.projects[0]?.id || ''}
                    onValueChange={setProjectId}
                    disabled={busy}
                  >
                    {snapshot?.projects.map((project) => (
                      <SelectItem value={project.id} key={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </Select>
                </FormField>
              )}
              <FormField label={composing ? 'What should we work on?' : 'Follow-up'}>
                <Textarea
                  value={draft}
                  onChange={(event) => editDraft(event.target.value)}
                  disabled={busy}
                  maxLength={12000}
                  rows={3}
                />
              </FormField>
              <Button
                type="submit"
                disabled={busy || !draft.trim()}
                loading={busy}
                loadingLabel="Sending…"
              >
                {composing ? 'Start task' : 'Send'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
