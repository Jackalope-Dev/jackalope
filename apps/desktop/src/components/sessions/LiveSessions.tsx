import { AgentCharacter } from '@jackalope/brand/agent-character';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { sessionWork } from '../../lib/live-session';
import { observeLiveSessions, useLiveSessionStore } from '../../stores/liveSessionStore';
import type { Project } from '../../stores/projectStore';
import { DailyWork } from '../tasks/DailyWork';
import { Button } from '../ui/button';
import { LiveSessionView } from './LiveSessionView';
import { SessionRecovery } from './SessionRecovery';
import { SessionStart } from './SessionStart';
import './live-session.css';
import { managedTaskWork } from '../../lib/managed-task';
import { useExecutionStore } from '../../stores/executionStore';
import { observeManagedTasks, useManagedTaskStore } from '../../stores/managedTaskStore';
import { ManagedTaskView } from '../tasks/ManagedTaskView';

export function LiveSessions({
  project,
  onOpenProject,
}: {
  project?: Project;
  onOpenProject: () => void;
}) {
  const { sessions, runs, selectedId, select, loading } = useLiveSessionStore();
  const [fresh, setFresh] = useState(0);
  const managed = useManagedTaskStore();
  const taskRuns = useExecutionStore((state) => state.runs);
  const managedTasks = (managed.queue.managedTasks ?? []).filter(
    (task) => !project || task.request.projectId === project.id,
  );
  const selectedTask = managedTasks.find((task) => task.id === managed.selectedId);
  useEffect(observeLiveSessions, []);
  useEffect(observeManagedTasks, []);
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
      <div className="live-hub-body" data-has-history={items.length > 0 || managedTasks.length > 0}>
        <div className="live-hub-canvas">
          {selectedTask ? (
            <ManagedTaskView
              key={selectedTask.id}
              task={selectedTask}
              onBack={() => managed.select(null)}
            />
          ) : session ? (
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
              <DailyWork />
            </>
          )}
        </div>
        {(items.length > 0 || managedTasks.length > 0) && (
          <nav className="live-history" aria-label="Chats">
            <div className="live-history-action">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-center"
                onClick={() => {
                  select(null);
                  managed.select(null);
                  setFresh((value) => value + 1);
                }}
              >
                <Plus size={15} />
                New chat
              </Button>
            </div>
            {managedTasks.length > 0 && (
              <section className="live-history-group">
                <h2>Planned tasks</h2>
                {managedTasks.map((task) => (
                  <button
                    type="button"
                    className="live-history-row"
                    key={task.id}
                    aria-current={selectedTask?.id === task.id ? 'page' : undefined}
                    onClick={() => {
                      select(null);
                      managed.select(task.id);
                    }}
                  >
                    <span className="live-history-copy">
                      <strong>{task.title}</strong>
                      <span className="live-muted">
                        {managedTaskWork(task, managed.queue, taskRuns).status}
                      </span>
                    </span>
                  </button>
                ))}
              </section>
            )}
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
                        onClick={() => {
                          managed.select(null);
                          select(item.id);
                        }}
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
