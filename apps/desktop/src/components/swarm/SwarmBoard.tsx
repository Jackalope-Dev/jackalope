import { Badge } from '@jackalope/ui';
import { AlertTriangle, GitFork } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { type CloudState, cloudState, conflictSummary, fileStatus } from '../../lib/swarm';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { AgentAvatar } from '../agents/AgentAvatar';
import { openSettings } from '../layout/navigation';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { LoadingState } from '../ui/LoadingState';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import './swarm.css';

const POLL_MS = 5000;
const FILES_SHOWN = 8;

const ago = (iso: string) => {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return new Date(iso).toLocaleTimeString();
};

/**
 * Every agent attempt on an Artifacts project works in its own fork; the swarm
 * Worker compares them and this board shows each fork and their conflicts.
 */
export function SwarmBoard() {
  const projectId = useProjectStore((state) => state.activeProjectId);
  const runs = useExecutionStore((state) => state.runs);
  const [state, setState] = useState<CloudState | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!projectId || !isTauriEnvironment()) return;
    let alive = true;
    const read = () =>
      cloudState(projectId)
        .then((next) => {
          if (!alive) return;
          setState(next);
          setError('');
        })
        .catch((cause) => alive && setError(String(cause)));
    void read();
    const timer = window.setInterval(read, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [projectId]);

  const runById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs]);
  const swarm = state?.swarm;
  const forks = swarm?.forks ?? [];
  const conflicts = swarm?.conflicts ?? [];
  const forkByName = useMemo(() => new Map(forks.map((fork) => [fork.fork, fork])), [forks]);
  const conflicted = useMemo(() => {
    const paths = new Map<string, Set<string>>();
    for (const conflict of conflicts)
      for (const fork of conflict.forks)
        paths.set(fork, (paths.get(fork) ?? new Set()).add(conflict.path));
    return paths;
  }, [conflicts]);
  const label = (forkName: string) => {
    const fork = forkByName.get(forkName);
    return fork ? fork.title || fork.agent : forkName;
  };

  return (
    <WorkspacePage className="swarm-page">
      <WorkspaceHeading
        title="Swarm"
        description="Each agent works in its own Artifacts fork. Your swarm Worker compares every fork after each snapshot, so overlapping edits surface while agents are still working."
      />
      {!isTauriEnvironment() && (
        <InlineNotice>The swarm is available in the desktop app.</InlineNotice>
      )}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {!state && isTauriEnvironment() && !error && (
        <LoadingState compact label="Reading the swarm…" />
      )}
      {state && !state.configured && (
        <InlineNotice
          action={
            <Button variant="outline" onClick={() => openSettings('Connected work')}>
              Connect swarm
            </Button>
          }
        >
          Connect your Jackalope Swarm Worker in Settings → Connected work to coordinate agents
          through Artifacts forks.
        </InlineNotice>
      )}
      {state?.configured && !state.repo && (
        <InlineNotice>
          This project has no Artifacts repository yet. Move it to Artifacts in Project settings,
          then start tasks; each attempt gets its own fork once it has changes.
        </InlineNotice>
      )}
      {state?.error && <InlineNotice tone="warning">{state.error}</InlineNotice>}
      {state?.repo && (
        <p className="swarm-meta">
          <GitFork size={14} aria-hidden="true" />
          <span>
            <code>{state.repo}</code> · {forks.length} {forks.length === 1 ? 'fork' : 'forks'}
            {state.syncedAt && ` · synced ${ago(state.syncedAt)}`}
          </span>
        </p>
      )}

      {conflicts.length > 0 && (
        <section className="workspace-section workspace-stack" aria-label="Conflicts">
          <WorkspaceSectionHeading
            title={`${conflicts.length} ${conflicts.length === 1 ? 'conflict' : 'conflicts'} between agents`}
          />
          <ul className="swarm-conflicts">
            {conflicts.map((conflict) => (
              <li key={`${conflict.forks.join('|')}:${conflict.path}`} className="swarm-conflict">
                <AlertTriangle size={16} aria-hidden="true" />
                <div>
                  <code>{conflict.path}</code>
                  <p>{conflictSummary(conflict)}</p>
                  <small>
                    {label(conflict.forks[0])} ↔ {label(conflict.forks[1])}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {state?.repo && (
        <section className="workspace-section workspace-stack" aria-label="Agent forks">
          <WorkspaceSectionHeading title="Agents" />
          {forks.length === 0 ? (
            <p className="task-muted">
              No agents are working yet. Start tasks on this project; each attempt appears here
              after its first snapshot.
            </p>
          ) : (
            <div className="swarm-lanes">
              {forks.map((fork) => {
                const run = runById.get(fork.attemptId);
                const hot = conflicted.get(fork.fork);
                return (
                  <article
                    key={fork.fork}
                    className="swarm-lane"
                    data-conflicted={hot?.size ? true : undefined}
                  >
                    <header>
                      <AgentAvatar provider={run?.agent ?? fork.agent} size="sm" />
                      <div>
                        <strong>{fork.title}</strong>
                        <small>
                          {run?.agent ?? fork.agent} · <code>{fork.fork}</code>
                        </small>
                      </div>
                      {hot?.size ? (
                        <Badge variant="danger">
                          {hot.size} {hot.size === 1 ? 'conflict' : 'conflicts'}
                        </Badge>
                      ) : (
                        <Badge variant="success">Clear</Badge>
                      )}
                    </header>
                    {fork.error ? (
                      <InlineNotice tone="warning">{fork.error}</InlineNotice>
                    ) : (
                      <>
                        <p className="task-muted">
                          {fork.files.length} {fork.files.length === 1 ? 'file' : 'files'} changed
                          {fork.truncated ? ' (partial)' : ''} · updated {ago(fork.updatedAt)}
                        </p>
                        <ul className="swarm-files">
                          {fork.files.slice(0, FILES_SHOWN).map((file) => (
                            <li key={file.path} data-conflicted={hot?.has(file.path) || undefined}>
                              <span className="swarm-file-status" data-status={fileStatus(file)}>
                                {fileStatus(file)[0].toUpperCase()}
                              </span>
                              <code>{file.path}</code>
                            </li>
                          ))}
                        </ul>
                        {fork.files.length > FILES_SHOWN && (
                          <p className="task-muted">{fork.files.length - FILES_SHOWN} more files</p>
                        )}
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </WorkspacePage>
  );
}
