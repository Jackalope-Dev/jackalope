import {
  askedText,
  type RemoteAction,
  requestText,
  sessionStatus,
  taskStatus,
  workTitle,
} from '@jackalope/contracts/remote';
import { isActive } from '@jackalope/contracts/runs';
import {
  Badge,
  Button,
  FormField,
  InlineNotice,
  Select,
  SelectItem,
  Textarea,
} from '@jackalope/ui';
import { ArrowUp, Pause, Play, Square } from 'lucide-react';
import { useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useRemoteWorkspace } from '../../desktop/src/components/remote/useRemoteWorkspace';
import { AgentQuestion } from '../../desktop/src/components/tasks/AgentQuestion';
import { ChangedFiles } from '../../desktop/src/components/tasks/ChangedFiles';
import { withoutLeadingId } from '../../desktop/src/lib/task-title.ts';
import { Avatar, Bar } from './Bar';
import { workspaceKey } from './drafts';
import { type Host, request as nativeRequest } from './native';

type Workspace = ReturnType<typeof useRemoteWorkspace>;

/** What a computer's screen opens to: one item of its work, or the new-work form. */
export type Opening = { selected: string } | { composing: true };

function Markdown({ children }: { children: string }) {
  return (
    <div className="task-markdown mobile-markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ alt }) => <span>{alt || 'Image'}</span>,
          a: ({ href, children: label }) => (
            <a
              href={href?.startsWith('https://') ? href : undefined}
              target="_blank"
              rel="noreferrer"
            >
              {label}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function Composer({ work, label }: { work: Workspace; label: string }) {
  return (
    <form
      className="mobile-composer mobile-glass"
      onSubmit={(event) => {
        event.preventDefault();
        void work.submit();
      }}
    >
      <Textarea
        aria-label={label}
        placeholder={label}
        value={work.draft}
        onChange={(event) => work.editDraft(event.target.value)}
        disabled={work.busy}
        maxLength={12000}
        rows={1}
      />
      <button
        type="submit"
        className="mobile-send"
        aria-label="Send"
        disabled={work.busy || !work.draft.trim()}
      >
        <ArrowUp size={20} aria-hidden="true" />
      </button>
    </form>
  );
}

function Conversation({
  work,
  host,
  showComputer,
  onBack,
}: {
  work: Workspace;
  host: Host;
  showComputer: boolean;
  onBack: () => void;
}) {
  const task = work.selectedTask;
  const session = work.selectedSession;
  const detail = work.currentDetail;
  const status = detail
    ? taskStatus(detail)
    : task
      ? taskStatus(task)
      : session && sessionStatus(session);
  const working = Boolean(task && isActive(task));
  const canSend = Boolean(session || (task && !task.sessionId));
  // Review is the next step once work stops; stop, pause and resume sit under the bar.
  const canReview = Boolean(task && !working);
  const options: { label: string; icon: typeof Pause; action: RemoteAction }[] = [];
  if (task && working)
    options.push({ label: 'Stop', icon: Square, action: { action: 'stop', runId: task.id } });
  if (session)
    options.push(
      session.paused
        ? {
            label: 'Resume conversation',
            icon: Play,
            action: { action: 'resume', sessionId: session.id },
          }
        : {
            label: 'Pause conversation',
            icon: Pause,
            action: { action: 'pause', sessionId: session.id },
          },
    );
  const context = [task?.projectName, showComputer && host.label].filter(Boolean).join(' · ');
  // Detail carries the whole request; until it loads, or from hosts that send only the
  // list's short title, the bubble shows that title.
  const asked = detail ? askedText(detail) : requestText(task?.title ?? session?.title ?? '');
  return (
    <main className="mobile-screen mobile-conversation">
      <Bar
        title={withoutLeadingId(task ? workTitle(task.title) : session?.title || 'Conversation')}
        subtitle={
          (status || context) && (
            <span className="mobile-bar-meta">
              {status && <Badge variant={status.variant}>{status.label}</Badge>}
              {context && <span>{context}</span>}
            </span>
          )
        }
        onBack={work.review ? work.closeReview : onBack}
      />
      {options.length > 0 && !work.review && (
        <div className="mobile-actions">
          {options.map((item) => (
            <Button
              key={item.label}
              variant="outline"
              size="sm"
              disabled={work.busy}
              onClick={() => void work.act(item.action)}
            >
              <item.icon size={16} aria-hidden="true" />
              {item.label}
            </Button>
          ))}
        </div>
      )}
      {work.error && <InlineNotice tone="error">{work.error}</InlineNotice>}
      {work.connectionError && <InlineNotice tone="warning">{work.connectionError}</InlineNotice>}
      {work.review ? (
        <div className="mobile-review">
          <ChangedFiles files={work.review.files} patch={work.review.diff} />
          {work.review.note && <p className="mobile-note">{work.review.note}</p>}
        </div>
      ) : (
        <div className="mobile-thread">
          {asked && (
            <article className="mobile-bubble" data-from="you">
              <Markdown>{asked}</Markdown>
            </article>
          )}
          {session?.error && <InlineNotice tone="error">{session.error}</InlineNotice>}
          {!!session?.pending && (
            <p className="mobile-note" role="status">
              {session.pending} message{session.pending === 1 ? '' : 's'} queued
              {session.paused ? ' · Paused' : ''}
            </p>
          )}
          {detail?.prompts
            // Answers an agent gave on your behalf show read-only beside questions waiting on you.
            .filter((prompt) => prompt.status !== 'answered' || prompt.answeredBy)
            .map((prompt) => (
              <AgentQuestion
                key={prompt.id}
                prompt={prompt}
                active={isActive(detail)}
                onAnswer={(text) => work.answer(detail.id, prompt.id, text)}
              />
            ))}
          {detail?.host && <p className="mobile-note">Runs on {detail.host}</p>}
          {detail?.error && detail.error !== session?.error && (
            <InlineNotice tone="error">{detail.error}</InlineNotice>
          )}
          {(detail?.result || working) && (
            <article className="mobile-bubble" data-from="agent">
              <Avatar agent={task?.agent} working={working} />
              <div className="mobile-bubble-body">
                {detail?.result ? (
                  <Markdown>{detail.result}</Markdown>
                ) : (
                  <p className="mobile-working">{detail?.activity.at(-1) ?? 'Working on it…'}</p>
                )}
              </div>
            </article>
          )}
          {canReview && (
            <Button
              variant="outline"
              className="mobile-review-button"
              disabled={work.busy}
              loading={work.busy}
              loadingLabel="Loading changes…"
              onClick={() => void work.loadReview()}
            >
              Review changes
            </Button>
          )}
          {task?.sessionId && !session && (
            <p className="mobile-note">This conversation is closed. Start new work to continue.</p>
          )}
        </div>
      )}
      {canSend && !work.review && <Composer work={work} label="Reply" />}
    </main>
  );
}

function NewWork({
  work,
  host,
  hosts,
  onBack,
  onSwitch,
}: {
  work: Workspace;
  host: Host;
  hosts: Host[];
  onBack: () => void;
  onSwitch: (host: Host) => void;
}) {
  const projects = work.snapshot?.projects ?? [];
  return (
    <main className="mobile-screen">
      <Bar title="New work" onBack={onBack} />
      {work.error && <InlineNotice tone="error">{work.error}</InlineNotice>}
      {work.connectionError && <InlineNotice tone="warning">{work.connectionError}</InlineNotice>}
      <form
        className="mobile-card mobile-glass mobile-new-work"
        onSubmit={(event) => {
          event.preventDefault();
          void work.submit();
        }}
      >
        {hosts.length > 1 && (
          <FormField label="Computer">
            <Select
              value={host.id}
              onValueChange={(id) => {
                const next = hosts.find((item) => item.id === id);
                if (next && next.id !== host.id) onSwitch(next);
              }}
              disabled={work.busy}
            >
              {hosts.map((item) => (
                <SelectItem value={item.id} key={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </Select>
          </FormField>
        )}
        <FormField label="Project">
          <Select
            value={work.projectId || projects[0]?.id || ''}
            onValueChange={work.setProjectId}
            disabled={work.busy || !projects.length}
            placeholder={work.snapshot ? 'No projects shared' : 'Loading…'}
          >
            {projects.map((project) => (
              <SelectItem value={project.id} key={project.id}>
                {project.hint ? `${project.name} (${project.hint})` : project.name}
              </SelectItem>
            ))}
          </Select>
        </FormField>
        <FormField label="What should we work on?">
          <Textarea
            value={work.draft}
            onChange={(event) => work.editDraft(event.target.value)}
            disabled={work.busy}
            maxLength={12000}
            rows={5}
          />
        </FormField>
        <div className="mobile-sticky-actions">
          <Button
            type="submit"
            size="lg"
            disabled={work.busy || !work.draft.trim() || !projects.length}
            loading={work.busy}
            loadingLabel="Starting…"
          >
            Start
          </Button>
        </div>
      </form>
    </main>
  );
}

/** One computer's open conversation or task, or the form that starts work on it. */
export function HostWork({
  host,
  hosts,
  opening,
  onBack,
  onSwitch,
}: {
  host: Host;
  hosts: Host[];
  opening: Opening;
  onBack: () => void;
  onSwitch: (host: Host) => void;
}) {
  const request = useCallback(
    <T,>(action: RemoteAction) => nativeRequest<T>(host.id, action),
    [host.id],
  );
  const work = useRemoteWorkspace(request, workspaceKey(host.id), opening);
  if (work.composing)
    return <NewWork work={work} host={host} hosts={hosts} onBack={onBack} onSwitch={onSwitch} />;
  return <Conversation work={work} host={host} showComputer={hosts.length > 1} onBack={onBack} />;
}
