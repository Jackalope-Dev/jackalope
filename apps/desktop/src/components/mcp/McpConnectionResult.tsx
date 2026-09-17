import { CheckCircle, CircleAlert, KeyRound, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { connectionFailure } from '../../lib/mcp-connection';
import { nativeTask } from '../../lib/task-runtime';
import type { McpServerConfig } from '../../lib/tauri-bridge';
import { useMcpStore } from '../../stores/mcpStore';
import { agentAccountFor, useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

export interface SavedMcpConnection {
  server: McpServerConfig;
  agentSignIn: boolean;
}

export function McpConnectionResult({
  saved,
  onDone,
  onEdit,
}: {
  saved: SavedMcpConnection;
  onDone: () => void;
  onEdit: () => void;
}) {
  const { server, agentSignIn } = saved;
  const key = `${server.scope}:${server.id}`;
  const probe = useMcpStore((state) => state.probeResults[key]);
  const checking = useMcpStore((state) => state.probingIds[key]);
  const project = useProjectStore((state) =>
    state.projects.find((item) =>
      server.scope === 'global'
        ? item.id === state.activeProjectId
        : `project:${item.id}` === server.scope,
    ),
  );
  const [signIn, setSignIn] = useState('');
  const [busy, setBusy] = useState(false);
  const failure = connectionFailure(probe?.error);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section
      className="mcp-configuration-saved"
      data-checked={probe?.ok === true}
      aria-label="Connection setup result"
    >
      {agentSignIn ? (
        <KeyRound size={28} />
      ) : probe?.ok ? (
        <CheckCircle size={28} />
      ) : (
        <CircleAlert size={28} />
      )}
      <h2 tabIndex={-1} ref={heading}>
        {agentSignIn
          ? 'Connection saved. Finish signing in.'
          : probe?.ok
            ? 'Connection checked'
            : 'Connection saved'}
      </h2>
      <p>
        {server.name} ·{' '}
        {server.scope === 'global' ? 'All projects' : (project?.name ?? 'This project')}
      </p>
      {server.enabled === false ? (
        <p>This connection is disabled. Enable it in settings when you want to use it again.</p>
      ) : agentSignIn ? (
        <>
          <p>
            Sign in separately for each agent you want to use. Complete authorization and check
            access in that agent. Saving does not confirm sign-in. Each button uses the account
            selected for the current project. Other accounts need their own sign-in.
          </p>
          <div className="mcp-result-actions">
            {(server.agents ?? ['codex', 'claude'])
              .filter((agent) => ['codex', 'claude'].includes(agent))
              .map((agent) => (
                <Button
                  key={agent}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await nativeTask('mcp_authenticate', {
                        id: server.id,
                        scope: server.scope,
                        agent,
                        profileId: project ? agentAccountFor(project, agent) : undefined,
                      });
                      setSignIn(
                        'Sign-in opened in your agent. Complete authorization there, then return to your task.',
                      );
                    } catch {
                      setSignIn(
                        'Could not open sign-in. Open your selected agent account in a terminal and use its MCP sign-in flow for this saved endpoint.',
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Sign in with {agent === 'claude' ? 'Claude' : 'Codex'}
                </Button>
              ))}
          </div>
          {signIn && <InlineNotice>{signIn}</InlineNotice>}
        </>
      ) : server.transport === 'sse' ? (
        <p>
          Use your agent to check this legacy SSE connection. Jackalope checks support remote HTTP
          and local commands.
        </p>
      ) : probe?.ok ? (
        <p role="status">
          Found {probe.tools.length} tools. This checks the server connection; individual actions
          still depend on your agent and permissions.
        </p>
      ) : (
        <InlineNotice tone={probe ? 'warning' : 'info'}>
          {probe
            ? `${failure.title}. ${failure.detail}`
            : 'Settings are saved. Check the connection before using it in a task.'}
        </InlineNotice>
      )}
      <div className="mcp-result-actions">
        {!agentSignIn && server.enabled !== false && server.transport !== 'sse' && (
          <Button
            variant="outline"
            loading={checking}
            loadingLabel="Checking…"
            onClick={() => void useMcpStore.getState().probeServer(server)}
          >
            <RefreshCw size={16} /> Check again
          </Button>
        )}
        <Button variant="outline" onClick={onEdit}>
          Edit settings
        </Button>
        <Button onClick={onDone}>Done</Button>
      </div>
      <p className="task-muted">
        Applies to new task attempts. Your current task and draft stay in place.
      </p>
    </section>
  );
}
