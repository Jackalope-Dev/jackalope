import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AllMcpsServer } from '../../stores/mcpStore';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { recommendationFor } from './curated-servers';
import { McpConnectionForm } from './McpConnectionForm';
import { McpConnectionResult, type SavedMcpConnection } from './McpConnectionResult';
import { McpServerIcon } from './McpServerIcon';
import { SourceLink } from './McpSourceLink';
import { marketplaceName } from './marketplace-info';
export function McpConfigureServer({
  server,
  onClose,
  onDone,
  defaultScope,
}: {
  server: AllMcpsServer;
  onClose: () => void;
  onDone: () => void;
  defaultScope?: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const projectId = useProjectStore((state) => state.activeProjectId);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SavedMcpConnection | null>(null);
  const [lastSaved, setLastSaved] = useState<SavedMcpConnection | null>(null);
  const recommendation = recommendationFor(server.id);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const snippet = Object.values(server.claudeConfigSnippet?.mcpServers ?? {})[0] ?? {};
  const env = {
    ...Object.fromEntries((server.envVars ?? []).map((key) => [key, ''])),
    ...snippet.env,
  };
  return (
    <section className="mcp-configure-page" aria-label={`Configure ${marketplaceName(server)}`}>
      <WorkspaceHeading
        title={`Configure ${marketplaceName(server)}`}
        titleRef={heading}
        description="Review the connection and choose where it is available."
        icon={<McpServerIcon server={server} />}
        action={
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            <ArrowLeft size={16} />
            Back to server
          </Button>
        }
      />
      {saved ? (
        <McpConnectionResult saved={saved} onDone={onDone} onEdit={() => setSaved(null)} />
      ) : (
        <>
          <InlineNotice className="mb-4">
            {recommendation?.setup ??
              'Review the publisher, connection settings, and required credentials.'}
            {!snippet.url &&
              ' Saving and checking starts this local process and may download its package.'}
            {recommendation && (
              <div className="mcp-detail-links">
                <SourceLink url={recommendation.documentation}>
                  {recommendation.publisher} setup guide
                </SourceLink>
              </div>
            )}
          </InlineNotice>
          <McpConnectionForm
            editing={!!lastSaved}
            initialAuthentication={
              lastSaved
                ? lastSaved.agentSignIn
                  ? 'oauth'
                  : undefined
                : recommendation?.authentication
            }
            initial={
              lastSaved?.server ?? {
                id: server.id,
                name: marketplaceName(server),
                scope: defaultScope ?? (projectId ? `project:${projectId}` : 'global'),
                description: server.description,
                command: snippet.command ?? '',
                args: snippet.args ?? [],
                url: snippet.url ?? '',
                transport:
                  snippet.type === 'sse'
                    ? 'sse'
                    : snippet.url || server.installKind === 'remote'
                      ? 'http'
                      : 'stdio',
                env,
                extra: Object.fromEntries(
                  Object.entries(snippet).filter(
                    ([key]) => !['command', 'args', 'env', 'url', 'type'].includes(key),
                  ),
                ),
              }
            }
            onCancel={onClose}
            onSaved={(result) => {
              setSaved(result);
              setLastSaved(result);
            }}
            onBusyChange={setBusy}
          />
        </>
      )}
    </section>
  );
}
