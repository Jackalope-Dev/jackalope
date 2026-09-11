import { AgentCharacter } from '@jackalope/brand/agent-character';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { sessionWork } from '../../lib/live-session';
import { observeLiveSessions, useLiveSessionStore } from '../../stores/liveSessionStore';
import type { Project } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { LiveSessionView } from './LiveSessionView';
import { SessionRecovery } from './SessionRecovery';
import { SessionStart } from './SessionStart';
import './live-session.css';

export function LiveSessions({
  project,
  onOpenProject,
}: {
  project?: Project;
  onOpenProject: () => void;
}) {
  const { sessions, runs, selectedId, select, loading } = useLiveSessionStore();
  const [fresh, setFresh] = useState(0);
  useEffect(observeLiveSessions, []);
  const session = sessions.find(
    (item) => item.id === selectedId && (!project || item.request.projectId === project.id),
  );
  const items = sessions
    .filter((item) => !project || item.request.projectId === project.id)
    .map((item) => {
      const work = sessionWork(item, runs);
      const group = item.closed
        ? 3
        : work.status === 'Needs attention' || work.questions.length
          ? 0
          : work.active || work.pending
            ? 1
            : 2;
      const activity = Math.max(
        ...[item.updatedAt, work.latest?.startedAt, work.latest?.endedAt].map(
          (time) => Date.parse(time ?? '') || 0,
        ),
      );
      return { session: item, work, group, activity };
    })
    .sort((a, b) => a.group - b.group || b.activity - a.activity);
  return (
    <section className="live-hub" aria-label="Chat">
      <header className="live-hub-heading">
        <h1>Chat</h1>
        {items.length > 0 && (
          <Button
            variant="ghost"
            onClick={() => {
              select(null);
              setFresh((value) => value + 1);
            }}
          >
            <Plus size={16} />
            New chat
          </Button>
        )}
      </header>
      <div className="live-hub-body" data-has-history={items.length > 0}>
        <div className="live-hub-canvas">
          {session ? (
            <LiveSessionView
              key={session.id}
              session={session}
              runs={runs}
              initialDetailsOpen={false}
            />
          ) : (
            <>
              <SessionRecovery />
              <SessionStart
                key={`${project?.id}:${fresh}`}
                project={project}
                onOpenProject={onOpenProject}
              />
            </>
          )}
        </div>
        {items.length > 0 && (
          <nav className="live-history" aria-label="Chats">
            {['Needs attention', 'In progress', 'Recent', 'Finished'].map((label, group) => {
              const members = items.filter((item) => item.group === group);
              return (
                members.length > 0 && (
                  <section key={label} className="live-history-group">
                    <h2>{label}</h2>
                    {members.map(({ session: item, work }) => (
                      <button
                        type="button"
                        className="live-history-row"
                        key={item.id}
                        aria-current={item.id === session?.id ? 'page' : undefined}
                        onClick={() => select(item.id)}
                      >
                        <span className="live-mascot" aria-hidden="true">
                          <AgentCharacter
                            provider={work.latest?.agent ?? item.request.agent}
                            state={
                              work.questions.length ? 'waiting' : work.active ? 'working' : 'idle'
                            }
                          />
                        </span>
                        <span className="live-history-copy">
                          <strong>{item.title}</strong>
                          <span className="live-muted">
                            {work.status === 'Queued' ? `${work.pending} queued` : work.status}
                            {work.pending && work.status !== 'Queued'
                              ? ` · ${work.pending} queued`
                              : ''}
                          </span>
                        </span>
                      </button>
                    ))}
                  </section>
                )
              );
            })}
          </nav>
        )}
      </div>
      {loading && !session && (
        <span className="live-loading" role="status">
          Loading chats…
        </span>
      )}
    </section>
  );
}
