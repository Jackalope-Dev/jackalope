import { ArrowLeft, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AllMcpsServer } from '../../stores/mcpStore';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { McpConnectionForm } from './McpConnectionForm';
import { McpServerIcon } from './McpServerIcon';
import { marketplaceName } from './marketplace-info';
export function McpConfigureServer({
  server,
  onClose,
  defaultScope,
}: {
  server: AllMcpsServer;
  onClose: () => void;
  defaultScope?: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const projectId = useProjectStore((state) => state.activeProjectId);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
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
        <div className="mcp-configuration-saved" role="status">
          <Check size={28} />
          <h2>Connection added</h2>
          <p>Available to new tasks in the selected scope.</p>
          <Button onClick={onClose}>Back to server</Button>
        </div>
      ) : (
        <>
          <InlineNotice className="mb-4">
            Review the publisher and command. Packages may download when the connection starts.
          </InlineNotice>
          <McpConnectionForm
            initial={{
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
            }}
            onCancel={onClose}
            onSaved={() => setSaved(true)}
            onBusyChange={setBusy}
          />
        </>
      )}
    </section>
  );
}
