import { Input, Tabs } from '@jackalope/ui';
import { ArrowLeft, ExternalLink, Search } from 'lucide-react';
import { lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import remarkGfm from 'remark-gfm';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { type AllMcpsServer, useMcpStore } from '../../stores/mcpStore';
import { Button } from '../ui/button';
import { LoadingState } from '../ui/LoadingState';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { McpConfigureServer } from './McpConfigureServer';
import { McpServerIcon } from './McpServerIcon';
import {
  categoryLabel,
  marketplaceName,
  marketplaceSetup,
  safeMarketplaceUrl,
  scopeLabel,
  sourceLabel,
} from './marketplace-info';

const Markdown = lazy(() => import('react-markdown'));

function dateLabel(value?: string | null) {
  if (!value) return 'Not reported';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not reported'
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function SourceLink({ url, children }: { url?: string | null; children: ReactNode }) {
  const href = safeMarketplaceUrl(url);
  const [error, setError] = useState(false);
  return href ? (
    <>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={async (event) => {
          if (!isTauriEnvironment()) return;
          event.preventDefault();
          try {
            const { open } = await import('@tauri-apps/plugin-shell');
            await open(href);
            setError(false);
          } catch {
            setError(true);
          }
        }}
      >
        {children}
        <ExternalLink size={13} aria-hidden="true" />
      </a>
      {error && <span role="alert">Could not open this link.</span>}
    </>
  ) : null;
}

export function McpServerPage({
  server,
  initialConfigure = false,
  onClose,
}: {
  server: AllMcpsServer;
  initialConfigure?: boolean;
  onClose: () => void;
}) {
  const [configuring, setConfiguring] = useState(initialConfigure);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!configuring) heading.current?.focus();
  }, [configuring]);
  const {
    inspectingServer,
    inspectingDetails,
    inspectError,
    loadingMarkdown,
    inspectServer,
    servers,
  } = useMcpStore();
  const [toolQuery, setToolQuery] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  if (!server) return null;
  const details = inspectingServer?.id === server.id ? inspectingDetails : null;
  const setup = marketplaceSetup(server);
  const tools = [
    ...new Map(
      (details?.tools ?? [])
        .filter((tool) => typeof tool.name === 'string')
        .map((tool) => [tool.name, tool]),
    ).values(),
  ];
  const filteredTools = tools.filter((tool) =>
    `${tool.name} ${tool.description ?? ''}`.toLowerCase().includes(toolQuery.toLowerCase()),
  );
  const scopes = [
    ...new Set(
      servers
        .filter((s) => s.id.toLowerCase() === server.id.toLowerCase())
        .map((s) => scopeLabel(s.scope)),
    ),
  ];

  if (configuring)
    return <McpConfigureServer server={server} onClose={() => setConfiguring(false)} />;
  return (
    <section className="mcp-server-page" aria-label={`${marketplaceName(server)} details`}>
      <WorkspaceHeading
        title={marketplaceName(server)}
        titleRef={heading}
        description={sourceLabel(server.url)}
        icon={<McpServerIcon server={server} />}
        action={
          <div className="mcp-server-actions">
            <Button variant="ghost" onClick={onClose}>
              <ArrowLeft size={16} />
              Back to marketplace
            </Button>
            <Button onClick={() => setConfiguring(true)}>
              {scopes.length ? 'Reconfigure' : 'Configure server'}
            </Button>
            <SourceLink url={server.detailUrl}>View on AllMCPs</SourceLink>
          </div>
        }
      />
      <div className="mcp-market-labels mb-6">
        <span>{categoryLabel(server.category)}</span>
        <span>{setup.remote ? 'Remote server' : 'Local process'}</span>
        {server.isOfficial && <span>Listed as official</span>}
      </div>
      <Tabs.Root
        defaultValue="overview"
        key={server.id}
        className="mcp-detail-tabs"
        onValueChange={() => scroll.current?.scrollTo({ top: 0 })}
      >
        <Tabs.List aria-label="Server information" className="mcp-detail-tab-list">
          <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
          <Tabs.Trigger value="tools">Tools{tools.length ? ` (${tools.length})` : ''}</Tabs.Trigger>
          <Tabs.Trigger value="setup">Setup</Tabs.Trigger>
          <Tabs.Trigger value="docs">Documentation</Tabs.Trigger>
        </Tabs.List>
        <div className="mcp-detail-scroll" ref={scroll}>
          {loadingMarkdown && <LoadingState label={'Loading details from AllMCPs…'} />}
          {inspectError && (
            <div role="alert" className="mcp-detail-notice">
              <p>{inspectError} The listing is still available below.</p>
              <Button variant="outline" size="sm" onClick={() => void inspectServer(server, true)}>
                Retry
              </Button>
            </div>
          )}
          <Tabs.Content value="overview" className="mcp-detail-content">
            <p className="mcp-detail-description">
              {details?.description || server.description || 'No description supplied.'}
            </p>
            {scopes.length > 0 && (
              <p className="mcp-detail-note">Configured in {scopes.join(', ')}.</p>
            )}
            <dl className="mcp-detail-facts">
              <div>
                <dt>Connection</dt>
                <dd>{setup.remote ? 'Remote MCP server' : 'Local process (stdio)'}</dd>
              </div>
              <div>
                <dt>Authentication</dt>
                <dd>{details?.authType || 'Not reported'}</dd>
              </div>
              <div>
                <dt>Pricing</dt>
                <dd>{details?.pricingModel || 'Not reported'}</dd>
              </div>
              <div>
                <dt>License</dt>
                <dd>{details?.license || 'Not reported'}</dd>
              </div>
              <div>
                <dt>Listed clients</dt>
                <dd>
                  {details?.compatibleClients?.length
                    ? details.compatibleClients.join(', ')
                    : 'Not reported'}
                </dd>
              </div>
              <div>
                <dt>Maintenance</dt>
                <dd>{details?.maintenanceStatus || 'Not reported'}</dd>
              </div>
              <div>
                <dt>Last repository commit</dt>
                <dd>{dateLabel(details?.lastCommitAt)}</dd>
              </div>
              <div>
                <dt>Last registry check</dt>
                <dd>{dateLabel(details?.lastCheckedAt)}</dd>
              </div>
            </dl>
            {details?.pricingNotes && <p>{details.pricingNotes}</p>}
            <section>
              <h3>Registry signals</h3>
              <div className="mcp-detail-signals">
                <span>{server.isOfficial ? 'Listed as official' : 'Community listing'}</span>
                <span>
                  {server.isVerifiedActive
                    ? 'Activity verified by AllMCPs'
                    : 'Activity not verified'}
                </span>
                <span>{server.githubStars.toLocaleString()} GitHub stars</span>
                {server.qualityScore > 0 && <span>AllMCPs score: {server.qualityScore}/100</span>}
                {server.npmDownloads != null && (
                  <span>{server.npmDownloads.toLocaleString()} npm downloads reported</span>
                )}
              </div>
              <p className="mcp-detail-note">
                Registry information is supplied by AllMCPs. Test the configured connection to check
                tools available to your agent.
              </p>
            </section>
            {details?.aiOverview || details?.aiFeatures?.length || details?.aiUseCases?.length ? (
              <section>
                <h3>AI-generated registry summary</h3>
                {details.aiOverview && <p>{details.aiOverview}</p>}
                {!!details.aiFeatures?.length && (
                  <ul>
                    {details.aiFeatures.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                )}
                {!!details.aiUseCases?.length && (
                  <>
                    <h3>Suggested uses</h3>
                    <ul>
                      {details.aiUseCases.map((use) => (
                        <li key={use}>{use}</li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            ) : null}
            <div className="mcp-detail-links">
              <SourceLink url={server.url}>Source repository</SourceLink>
              <SourceLink url={details?.websiteUrl}>Website</SourceLink>
              <SourceLink url={details?.supportUrl}>Support</SourceLink>
            </div>
          </Tabs.Content>
          <Tabs.Content value="tools" className="mcp-detail-content">
            <p className="mcp-detail-note">
              {tools.length} tools listed by AllMCPs
              {details?.toolsSource ? ` · Source: ${details.toolsSource}` : ''}. This is a registry
              inventory, not a live connection test.
            </p>
            {tools.length > 0 ? (
              <>
                <label className="mcp-tool-search">
                  <Search size={16} aria-hidden="true" />
                  <Input
                    aria-label="Search listed tools"
                    placeholder="Find a tool…"
                    value={toolQuery}
                    onChange={(event) => setToolQuery(event.target.value)}
                  />
                </label>
                <ul className="mcp-detail-tool-list">
                  {filteredTools.map((tool) => (
                    <li key={tool.name}>
                      <h3>
                        <code>{tool.name}</code>
                      </h3>
                      <p>{tool.description || 'No description supplied.'}</p>
                      {tool.inputSchema && (
                        <details>
                          <summary>Input schema</summary>
                          <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
                {!filteredTools.length && <p>No tools match “{toolQuery}”.</p>}
              </>
            ) : (
              !loadingMarkdown && (
                <p>
                  The registry has no tool inventory for this server. Check its documentation or
                  test the connection after configuring it.
                </p>
              )
            )}
          </Tabs.Content>
          <Tabs.Content value="setup" className="mcp-detail-content">
            <section className={setup.reviewNeeded ? 'mcp-detail-notice' : ''}>
              <h3>{setup.reviewNeeded ? 'Review the suggested setup' : 'Installation guidance'}</h3>
              <p>
                {server.installNote ||
                  'Review the server documentation for prerequisites and credentials.'}
              </p>
              <p className="mcp-detail-note">
                AllMCPs installation confidence: {server.installConfidence || 'not reported'}.
              </p>
            </section>
            <section>
              <h3>Before configuring</h3>
              <p>
                {setup.remote
                  ? 'You will need a remote MCP endpoint and any authentication required by the provider.'
                  : `This runs a process on your computer${setup.config?.command ? ` using ${setup.config.command}` : ''}. Check the project documentation for runtime and package prerequisites.`}
              </p>
            </section>
            <section>
              <h3>Environment fields</h3>
              {setup.envVars.length ? (
                <>
                  <p>Supply these values during configuration:</p>
                  <ul className="mcp-env-list">
                    {setup.envVars.map((name) => (
                      <li key={name}>
                        <code>{name}</code>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>
                  No environment fields are listed. The server may still require authentication or
                  other configuration.
                </p>
              )}
            </section>
            <section>
              <h3>Suggested configuration</h3>
              {setup.config ? (
                <pre>{JSON.stringify(server.claudeConfigSnippet, null, 2)}</pre>
              ) : (
                <p>
                  No configuration snippet was provided. Check the source documentation before
                  adding this server manually.
                </p>
              )}
            </section>
            <p className="mcp-detail-note">
              Choose Global, Claude Code, Codex or Grok in the next step. Jackalope writes the
              selected client configuration; restart existing agent sessions to pick up changes.
            </p>
          </Tabs.Content>
          <Tabs.Content value="docs" className="mcp-detail-content">
            {details?.readme ? (
              <>
                <p className="mcp-detail-note">
                  Repository README supplied by AllMCPs. Images and relative links are available in
                  the source repository.
                </p>
                <div className="mcp-readme">
                  <Suspense fallback={<LoadingState label="Rendering documentation…" compact />}>
                    <Markdown
                      skipHtml
                      remarkPlugins={[remarkGfm]}
                      components={{
                        table: ({ children }) => (
                          <section
                            className="mcp-readme-table"
                            aria-label="Documentation table"
                            // biome-ignore lint/a11y/noNoninteractiveTabindex: Wide tables need keyboard scrolling.
                            tabIndex={0}
                          >
                            <table>{children}</table>
                          </section>
                        ),
                        a: ({ href, children }) =>
                          safeMarketplaceUrl(href) ? (
                            <SourceLink url={href}>{children}</SourceLink>
                          ) : (
                            <span>{children}</span>
                          ),
                        img: ({ alt }) => (
                          <span className="mcp-detail-note">
                            {alt ? `[Image: ${alt}]` : '[Image]'}
                          </span>
                        ),
                      }}
                    >
                      {details.readme}
                    </Markdown>
                  </Suspense>
                </div>
              </>
            ) : (
              !loadingMarkdown && (
                <>
                  <p>No README was supplied by the registry.</p>
                  <SourceLink url={server.url}>Open source documentation</SourceLink>
                </>
              )
            )}
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </section>
  );
}
