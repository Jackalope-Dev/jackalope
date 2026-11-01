import { AgentCharacter } from '@jackalope/brand/agent-character';
import { Badge, Button, FormField, Select, SelectItem, Textarea } from '@jackalope/ui';
import { ArrowUp, ChevronLeft, MessageCircle, Plus, RefreshCw } from 'lucide-react';
import { type ReactNode, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  isActive,
  type RemoteAction,
  useRemoteWorkspace,
} from '../../desktop/src/components/remote/useRemoteWorkspace';
import { AgentQuestion } from '../../desktop/src/components/tasks/AgentQuestion';
import { ChangedFiles } from '../../desktop/src/components/tasks/ChangedFiles';
import { InlineNotice } from '../../desktop/src/components/ui/InlineNotice';
import { agentProvider } from '../../desktop/src/lib/agent-provider';
import { type Host, request as nativeRequest } from './native';
import { sessionStatus, since, taskStatus, type WorkStatus } from './status';
import '../../desktop/src/components/agents/agent-avatar.css';

type Workspace = ReturnType<typeof useRemoteWorkspace>;

function Avatar({ agent, working }: { agent?: string; working?: boolean }) {
  return (
    <span className="agent-avatar" data-size="sm" aria-hidden="true">
      <AgentCharacter provider={agentProvider(agent)} state={working ? 'working' : 'idle'} />
    </span>
  );
}

function Bar({
  title,
  subtitle,
  onBack,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onBack?: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="mobile-bar mobile-glass">
      {onBack && (
        <button type="button" className="mobile-icon-button" aria-label="Back" onClick={onBack}>
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
      )}
      <div className="mobile-bar-title">
        <h1>{title}</h1>
        {subtitle && <span>{subtitle}</span>}
      </div>
      {children}
    </header>
  );
}

function Markdown({ children }: { children: string }) {
  return (
    <div className="task-markdown">
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

interface Row {
  id: string;
  title: string;
  meta: string;
  agent?: string;
  status: WorkStatus;
}

function WorkList({ host, work, onHosts }: { host: Host; work: Workspace; onHosts: () => void }) {
  const rows: Row[] = [
    ...work.waitingSessions.map((session) => ({
      id: session.id,
      title: session.title,
      meta: work.snapshot?.projects.find((p) => p.id === session.projectId)?.name ?? '',
      status: sessionStatus(session),
    })),
    ...work.latestTasks.map((task) => ({
      id: task.sessionId || task.taskId,
      title: task.title,
      meta: `${task.projectName} · ${since(task.startedAt)}`,
      agent: task.agent,
      status: taskStatus(task),
    })),
  ];
  const groups: [string, Row[]][] = [
    ['Needs you', rows.filter((row) => row.status.needsYou)],
    ['Working', rows.filter((row) => row.status.working)],
    ['Recent', rows.filter((row) => !row.status.needsYou && !row.status.working)],
  ];
  const connected = work.status === 'Connected';
  return (
    <main className="mobile-screen">
      <Bar
        title={host.label}
        subtitle={
          <span className="mobile-connection" data-connected={connected || undefined}>
            {work.status}
          </span>
        }
        onBack={onHosts}
      >
        <button
          type="button"
          className="mobile-icon-button"
          aria-label="Refresh"
          onClick={() => {
            work.setError('');
            void work.refresh();
          }}
        >
          <RefreshCw size={18} aria-hidden="true" />
        </button>
      </Bar>
      {work.error && <InlineNotice tone="error">{work.error}</InlineNotice>}
      {work.connectionError && <InlineNotice tone="error">{work.connectionError}</InlineNotice>}
      {groups.map(
        ([label, items]) =>
          items.length > 0 && (
            <section key={label} className="mobile-section" aria-label={label}>
              <h2>
                {label} <span>{items.length}</span>
              </h2>
              <ul className="mobile-list mobile-card mobile-glass">
                {items.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="mobile-row"
                      onClick={() => work.choose(row.id)}
                    >
                      {row.agent ? (
                        <Avatar agent={row.agent} working={row.status.working} />
                      ) : (
                        <span className="mobile-host-icon" aria-hidden="true">
                          <MessageCircle size={18} />
                        </span>
                      )}
                      <span className="mobile-row-body">
                        <strong>{row.title}</strong>
                        <span className="mobile-row-meta">
                          <Badge variant={row.status.variant}>{row.status.label}</Badge>
                          <small>{row.meta}</small>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
      {work.snapshot && !rows.length && (
        <p className="mobile-empty">No work on this computer yet.</p>
      )}
      <button
        type="button"
        className="mobile-fab"
        disabled={!work.snapshot?.projects.length || work.busy}
        onClick={work.compose}
      >
        <Plus size={20} aria-hidden="true" />
        New work
      </button>
    </main>
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

function Conversation({ work }: { work: Workspace }) {
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
  const actions: { label: string; action: () => void }[] = [];
  if (task && !working)
    actions.push({ label: 'Review changes', action: () => void work.loadReview() });
  if (task && working)
    actions.push({
      label: 'Stop',
      action: () => void work.act({ action: 'stop', runId: task.id }),
    });
  if (session)
    actions.push({
      label: session.paused ? 'Resume' : 'Pause queue',
      action: () =>
        void work.act({
          action: session.paused ? 'resume' : 'pause',
          sessionId: session.id,
        } satisfies RemoteAction),
    });
  return (
    <main className="mobile-screen mobile-conversation">
      <Bar
        title={session?.title || task?.title || 'Conversation'}
        subtitle={task?.projectName}
        onBack={work.review ? work.closeReview : work.close}
      >
        {status && <Badge variant={status.variant}>{status.label}</Badge>}
      </Bar>
      {actions.length > 0 && !work.review && (
        <div className="mobile-actions">
          {actions.map((item) => (
            <Button
              key={item.label}
              variant="outline"
              size="sm"
              disabled={work.busy}
              onClick={item.action}
            >
              {item.label}
            </Button>
          ))}
        </div>
      )}
      {work.error && <InlineNotice tone="error">{work.error}</InlineNotice>}
      {work.review ? (
        <div className="mobile-review">
          <ChangedFiles files={work.review.files} patch={work.review.diff} />
          <p className="mobile-note">{work.review.note}</p>
        </div>
      ) : (
        <div className="mobile-thread">
          <article className="mobile-bubble" data-from="you">
            <p>{session?.title || task?.title}</p>
          </article>
          {session?.error && <InlineNotice tone="error">{session.error}</InlineNotice>}
          {!!session?.pending && (
            <p className="mobile-note" role="status">
              {session.pending} message{session.pending === 1 ? '' : 's'} queued
              {session.paused ? ' · Paused' : ''}
            </p>
          )}
          {detail?.prompts
            .filter((prompt) => prompt.status === 'pending')
            .map((prompt) => (
              <AgentQuestion
                key={prompt.id}
                prompt={prompt}
                active={isActive(detail)}
                onAnswer={(text) => work.answer(detail.id, prompt.id, text)}
              />
            ))}
          {detail?.error && <InlineNotice tone="error">{detail.error}</InlineNotice>}
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
          {task?.sessionId && !session && (
            <p className="mobile-note">This conversation is closed. Start new work to continue.</p>
          )}
        </div>
      )}
      {canSend && !work.review && <Composer work={work} label="Reply" />}
    </main>
  );
}

function NewWork({ work }: { work: Workspace }) {
  return (
    <main className="mobile-screen">
      <Bar title="New work" onBack={work.close} />
      {work.error && <InlineNotice tone="error">{work.error}</InlineNotice>}
      <form
        className="mobile-card mobile-glass mobile-new-work"
        onSubmit={(event) => {
          event.preventDefault();
          void work.submit();
        }}
      >
        <FormField label="Project">
          <Select
            value={work.projectId || work.snapshot?.projects[0]?.id || ''}
            onValueChange={work.setProjectId}
            disabled={work.busy}
          >
            {work.snapshot?.projects.map((project) => (
              <SelectItem value={project.id} key={project.id}>
                {project.name}
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
        <Button
          type="submit"
          disabled={work.busy || !work.draft.trim()}
          loading={work.busy}
          loadingLabel="Starting…"
        >
          Start
        </Button>
      </form>
    </main>
  );
}

/** One computer's work: its list, an open conversation or task, or new work. */
export function HostWork({ host, onHosts }: { host: Host; onHosts: () => void }) {
  const request = useCallback(
    <T,>(action: RemoteAction) => nativeRequest<T>(host.id, action),
    [host.id],
  );
  const work = useRemoteWorkspace(request, `jackalope-mobile:${host.id}`);
  if (work.composing) return <NewWork work={work} />;
  if (work.selected) return <Conversation work={work} />;
  return <WorkList host={host} work={work} onHosts={onHosts} />;
}
