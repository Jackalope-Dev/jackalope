import {
  Button,
  Disclosure,
  DisclosureSummary,
  FormField,
  Select,
  SelectItem,
  Textarea,
} from '@jackalope/ui';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AgentQuestion } from '../tasks/AgentQuestion';
import { ChangedFiles } from '../tasks/ChangedFiles';
import { InlineNotice } from '../ui/InlineNotice';
import { isActive as active, type RemoteRequest, useRemoteWorkspace } from './useRemoteWorkspace';
import './remote.css';

export type { RemoteAction, RemoteRequest } from './useRemoteWorkspace';

export function RemoteWorkspace({
  request,
  storageKey,
}: {
  request: RemoteRequest;
  storageKey: string;
}) {
  const {
    snapshot,
    status,
    error,
    setError,
    connectionError,
    busy,
    selected,
    selectedTask,
    selectedSession,
    currentDetail,
    review,
    closeReview,
    latestTasks,
    waitingSessions,
    composing,
    projectId,
    setProjectId,
    draft,
    editDraft,
    refresh,
    act,
    submit,
    loadReview,
    answer,
    choose,
    compose,
  } = useRemoteWorkspace(request, storageKey);
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
        <Button disabled={!snapshot?.projects.length || busy} onClick={compose}>
          New task
        </Button>
      </div>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {connectionError && <InlineNotice tone="error">{connectionError}</InlineNotice>}
      <div className="remote-layout">
        <nav className="remote-task-list" aria-label="Host tasks">
          {waitingSessions.map((session) => (
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
                    onClick={() => void loadReview()}
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
                    onAnswer={(text) => answer(currentDetail.id, prompt.id, text)}
                  />
                ))}
              {review ? (
                <>
                  <Button variant="ghost" onClick={closeReview}>
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
            <p className="task-muted">This conversation is closed. Start a new task to continue.</p>
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
