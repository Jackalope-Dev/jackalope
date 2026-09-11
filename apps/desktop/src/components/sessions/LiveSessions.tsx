import { AgentCharacter } from '@jackalope/brand/agent-character';
import { Input } from '@jackalope/ui';
import { ArrowLeft, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { sessionCommand, sessionWork } from '../../lib/live-session';
import type { RunRequest } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { syncAgentConfig } from '../../stores/agentConfigStore';
import { observeLiveSessions, useLiveSessionStore } from '../../stores/liveSessionStore';
import { agentAccountFor, type Project } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { LiveSessionView } from './LiveSessionView';
import './live-session.css';

export function LiveSessions({ project, onBack }: { project?: Project; onBack: () => void }) {
  const { sessions, runs, selectedId, select, loading, error, refresh } = useLiveSessionStore();
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const creationId = useRef<string | null>(null);
  useEffect(observeLiveSessions, []);
  const session = sessions.find((s) => s.id === selectedId);
  if (session) return <LiveSessionView session={session} runs={runs} onBack={() => select(null)} />;
  const create = async () => {
    if (!project || creating) return;
    setCreating(true);
    setCreateError('');
    creationId.current ??= crypto.randomUUID();
    const id = creationId.current;
    try {
      await syncAgentConfig();
      const agent = project.preferences?.preferredRunner || 'auto';
      const request: RunRequest = {
        id,
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        agent,
        agentProfileId: agentAccountFor(project, agent),
        prompt: 'Live session',
        isolated: true,
        targetBranch: project.preferences?.baseBranch || project.gitBranch,
        verifyCommand: project.preferences?.verifyCommand,
        prepareCommand: project.preferences?.prepareCommand,
        autoVerify: project.preferences?.autoVerify ?? true,
      };
      await sessionCommand('create', {
        id,
        title: title.trim() || `${project.name} session`,
        request,
      });
      await refresh(id);
      select(id);
      creationId.current = null;
      setTitle('');
    } catch (cause) {
      setCreateError(String(cause));
    } finally {
      setCreating(false);
    }
  };
  const visible = sessions.filter((s) => !project || s.request.projectId === project.id).reverse();
  return (
    <WorkspacePage>
      <WorkspaceHeading
        title="Live sessions"
        action={
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={16} />
            Tasks
          </Button>
        }
      />
      {project && (
        <form
          className="live-create"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <Input
            aria-label="Session name"
            placeholder="Session name"
            value={title}
            disabled={creating}
            onChange={(event) => {
              setTitle(event.target.value);
              creationId.current = null;
            }}
            maxLength={160}
          />
          <Button
            type="submit"
            loading={creating}
            loadingLabel="Creating…"
            disabled={creating || !isTauriEnvironment()}
          >
            <Plus size={16} />
            Start session
          </Button>
        </form>
      )}
      {!project && <p className="live-muted">Choose a project to start a session.</p>}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {createError && <InlineNotice tone="error">{createError}</InlineNotice>}
      {loading ? (
        <p role="status">Loading sessions…</p>
      ) : (
        <div className="live-session-list">
          {visible.map((item) => {
            const work = sessionWork(item, runs);
            return (
              <button
                type="button"
                className="live-session-row"
                key={item.id}
                onClick={() => select(item.id)}
              >
                <span className="live-mascot">
                  <AgentCharacter
                    provider={work.latest?.agent ?? item.request.agent}
                    state={work.active ? 'working' : 'idle'}
                  />
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <span className="live-muted">
                    {work.status}
                    {work.pending ? ` · ${work.pending} queued` : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </WorkspacePage>
  );
}
