import { Badge, LoadingIcon, RefreshIcon, SearchField } from '@jackalope/ui';
import {
  Activity,
  Check,
  CheckCircle,
  Copy,
  Globe,
  Pencil,
  Plus,
  Search,
  Server,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { builtinAgents } from '../../lib/agent-catalog';
import { nativeTask } from '../../lib/task-runtime';
import type { McpServerConfig } from '../../lib/tauri-bridge';
import { type AllMcpsServer, useMcpStore } from '../../stores/mcpStore';
import { agentAccountFor, useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Button } from '../ui/button';
import { ConfirmAction } from '../ui/ConfirmAction';
import { EmptyState } from '../ui/EmptyState';
import { InlineNotice } from '../ui/InlineNotice';

import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { FilterGroup, WorkspaceToolbar } from '../ui/WorkspaceToolbar';
import { McpAddCustomModal } from './McpAddCustomModal';
import { McpMarketplaceCard } from './McpMarketplaceCard';
import { McpServerPage } from './McpServerPage';
import './mcp.css';

const CATEGORIES = [
  { id: 'all', label: 'All Categories' },
  { id: 'databases', label: '🗄️ Databases' },
  { id: 'search-and-data-extraction', label: '🔎 Search & Web' },
  { id: 'developer-tools', label: '🛠️ Dev Tools' },
  { id: 'version-control', label: '🔄 Git & PR' },
  { id: 'cloud-platforms', label: '☁️ Cloud' },
  { id: 'knowledge-and-memory', label: '🧠 Memory & RAG' },
  { id: 'communication', label: '💬 Team Chat' },
];

export function McpWorkspace({
  view,
  onViewChange,
}: {
  view?: 'configured' | 'marketplace';
  onViewChange?: (view: 'configured' | 'marketplace') => void;
} = {}) {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const project = useProjectStore((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const {
    servers,
    loadingServers,
    serversError,
    probeResults,
    probingIds,
    marketplaceServers,
    loadingMarketplace,
    marketplaceError,
    searchQuery,
    selectedCategory,
    loadServers,
    deleteServer,
    probeServer,
    setSearchQuery,
    setSelectedCategory,
    searchMarketplace,
    inspectServer,
  } = useMcpStore();

  const { useMcpMarketplace, setUseMcpMarketplace } = useSettingsStore();

  const [localTab, setLocalTab] = useState<'configured' | 'marketplace'>('configured');
  const activeTab = view ?? localTab;
  const setActiveTab = (next: 'configured' | 'marketplace') => {
    setLocalTab(next);
    onViewChange?.(next);
  };
  const [scopeFilter, setScopeFilter] = useState('all');
  const [configuredSearch, setConfiguredSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState('');

  // Modals
  const [initialConfigure, setInitialConfigure] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  const returnTo = useRef<{ top: number; id: string; configure: boolean } | null>(null);
  const [inspectingServer, setInspectingServer] = useState<AllMcpsServer | null>(null);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null);

  useEffect(() => {
    void loadServers(activeProjectId);
  }, [loadServers, activeProjectId]);

  // Debounced search for marketplace
  useEffect(() => {
    if (activeTab !== 'marketplace' || !useMcpMarketplace) return;
    const timer = setTimeout(() => {
      void searchMarketplace(searchQuery, selectedCategory);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedCategory, activeTab, useMcpMarketplace, searchMarketplace]);

  const openListing = (server: AllMcpsServer, configure = false) => {
    returnTo.current = { top: workspace.current?.scrollTop ?? 0, id: server.id, configure };
    setInitialConfigure(configure);
    setInspectingServer(server);
    void inspectServer(server);
  };
  useLayoutEffect(() => {
    if (inspectingServer) workspace.current?.scrollTo({ top: 0 });
    else if (returnTo.current) {
      const target = returnTo.current;
      const card = [
        ...(workspace.current?.querySelectorAll<HTMLElement>('[data-server-id]') ?? []),
      ].find((element) => element.dataset.serverId === target.id);
      card
        ?.querySelector<HTMLButtonElement>(
          `[data-action="${target.configure ? 'configure' : 'inspect'}"]`,
        )
        ?.focus({ preventScroll: true });
      workspace.current?.scrollTo({ top: target.top });
      returnTo.current = null;
    }
  }, [inspectingServer]);

  const handleCopyJson = async (server: McpServerConfig) => {
    const snippet = {
      mcpServers: {
        [server.id]: {
          ...server.extra,
          ...(server.url
            ? { type: server.transport, url: server.url }
            : {
                command: server.command,
                args: server.args,
              }),
          env: server.env,
          description: server.description,
        },
      },
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(snippet, null, 2));
      setCopiedId(`${server.scope}:${server.id}`);
      setCopyError('');
    } catch {
      setCopyError(
        'Could not copy the configuration. Open Edit to inspect the connection settings.',
      );
    }
  };

  const filteredServers = servers.filter((s) => {
    if (scopeFilter !== 'all' && s.scope !== scopeFilter) return false;
    if (configuredSearch.trim()) {
      const q = configuredSearch.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        probeResults[`${s.scope}:${s.id}`]?.tools.some(
          (tool) =>
            tool.name.toLowerCase().includes(q) || tool.description?.toLowerCase().includes(q),
        )
      );
    }
    return true;
  });

  return (
    <WorkspacePage className="mcp-workspace" ref={workspace}>
      {inspectingServer && activeTab === 'marketplace' ? (
        <McpServerPage
          key={inspectingServer.id}
          server={inspectingServer}
          initialConfigure={initialConfigure}
          onClose={() => {
            setInspectingServer(null);
            useMcpStore.getState().clearInspecting();
          }}
        />
      ) : (
        <>
          <WorkspaceHeading
            title={activeTab === 'configured' ? 'MCP connections' : 'MCP marketplace'}
            description={
              activeTab === 'marketplace'
                ? 'Third-party tools are not provided or audited by Jackalope. Use at your own risk; Jackalope is not responsible for their safety, reliability or data handling.'
                : undefined
            }
            action={
              <div className="flex flex-wrap items-center gap-2">
                {activeTab === 'configured' && (
                  <Button variant="outline" onClick={() => setActiveTab('marketplace')}>
                    <Globe size={16} />
                    Browse marketplace
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => {
                    void loadServers(undefined, true);
                    if (useMcpMarketplace && activeTab === 'marketplace') {
                      void searchMarketplace(undefined, undefined, true);
                    }
                  }}
                  disabled={loadingServers || loadingMarketplace}
                >
                  <RefreshIcon size={16} />
                  Refresh
                </Button>
                <Button
                  onClick={() => {
                    setEditingServer(null);
                    setCustomModalOpen(true);
                  }}
                >
                  <Plus size={16} />
                  Add connection
                </Button>
              </div>
            }
          />
          {copyError && (
            <InlineNotice tone="error" className="mb-4">
              {copyError}
            </InlineNotice>
          )}

          {/* Main Tabs */}
          {!view && (
            <nav className="mcp-tabs" aria-label="MCP views">
              <button
                type="button"
                onClick={() => setActiveTab('configured')}
                aria-pressed={activeTab === 'configured'}
                className={`mcp-tab-btn ${activeTab === 'configured' ? 'active' : ''}`}
              >
                <Server size={17} />
                <span>Connections</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-surface-elevated)] border border-[var(--color-border)]">
                  {servers.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('marketplace')}
                aria-pressed={activeTab === 'marketplace'}
                className={`mcp-tab-btn ${activeTab === 'marketplace' ? 'active' : ''}`}
              >
                <Globe size={17} />
                <span>Marketplace</span>
              </button>
            </nav>
          )}

          {/* Tab 1: Configured MCPs */}
          {activeTab === 'configured' && (
            <section>
              {serversError && (
                <InlineNotice tone="error" className="mb-4">
                  {serversError}
                </InlineNotice>
              )}

              {/* Scope Filters & Search */}
              <WorkspaceToolbar className="mb-4">
                <FilterGroup
                  label="Connection scope"
                  value={scopeFilter}
                  onChange={setScopeFilter}
                  items={[
                    { id: 'all', label: `All (${servers.length})` },
                    ...(activeProjectId
                      ? [
                          {
                            id: `project:${activeProjectId}`,
                            label: `This project (${servers.filter((s) => s.scope === `project:${activeProjectId}`).length})`,
                          },
                        ]
                      : []),
                    {
                      id: 'global',
                      label: `Global (${servers.filter((s) => s.scope === 'global').length})`,
                    },
                    {
                      id: 'claude',
                      label: `Claude Code (${servers.filter((s) => s.scope === 'claude').length})`,
                    },
                    {
                      id: 'codex',
                      label: `Codex (${servers.filter((s) => s.scope === 'codex').length})`,
                    },
                    {
                      id: 'grok',
                      label: `Grok (${servers.filter((s) => s.scope === 'grok').length})`,
                    },
                  ]}
                />

                <SearchField
                  aria-label="Filter connections"
                  className="with-search-icon"
                  placeholder="Filter connections or checked tools…"
                  value={configuredSearch}
                  onValueChange={(value) => setConfiguredSearch(value)}
                  containerClassName="relative min-w-56"
                />
              </WorkspaceToolbar>

              {/* Servers Grid */}
              {loadingServers ? (
                <p role="status" className="task-muted py-8">
                  Reading configured connections…
                </p>
              ) : serversError && !servers.length ? null : filteredServers.length === 0 ? (
                <EmptyState
                  icon={Server}
                  title={
                    servers.length === 0 ? 'No MCP servers configured' : 'No matching MCP servers'
                  }
                  description={
                    servers.length === 0
                      ? 'Add a connection or browse the marketplace.'
                      : 'Try selecting a different scope or clearing your search query.'
                  }
                  action={
                    servers.length === 0 ? (
                      <div className="flex gap-2 mt-4">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setEditingServer(null);
                            setCustomModalOpen(true);
                          }}
                        >
                          <Plus size={15} /> Add Custom
                        </Button>
                        <Button onClick={() => setActiveTab('marketplace')}>
                          <Globe size={15} /> Browse marketplace
                        </Button>
                      </div>
                    ) : undefined
                  }
                />
              ) : (
                <div className="mcp-grid">
                  {filteredServers.map((server) => {
                    const key = `${server.scope}:${server.id}`;
                    const probe = probeResults[key];
                    const isProbing = !!probingIds[key];
                    const envCount = Object.keys(server.env || {}).length;

                    return (
                      <article key={key} className="mcp-card">
                        <div>
                          <div className="mcp-card-header">
                            <h3 className="mcp-card-title">{server.name}</h3>
                            <div className="mcp-card-badges">
                              {!server.discovery &&
                                server.transport === 'http' &&
                                (server.scope === 'codex' ||
                                  server.scope === 'claude' ||
                                  server.scope.startsWith('project:') ||
                                  server.scope === 'global') &&
                                (server.scope === 'codex' || server.scope === 'claude'
                                  ? [server.scope]
                                  : ['codex', 'claude']
                                )
                                  .filter(
                                    (agent) => !server.agents || server.agents.includes(agent),
                                  )
                                  .map((agent) => (
                                    <Button
                                      key={agent}
                                      variant="ghost"
                                      onClick={() =>
                                        void nativeTask('mcp_authenticate', {
                                          id: server.id,
                                          scope: server.scope,
                                          agent,
                                          profileId: server.scope.startsWith('project:')
                                            ? agentAccountFor(project, agent)
                                            : undefined,
                                        })
                                          .then(() =>
                                            setCopyError(
                                              'Sign-in opened in your CLI. Complete authorization and check access there. Connection probes use configured headers or environment tokens.',
                                            ),
                                          )
                                          .catch((error) => setCopyError(String(error)))
                                      }
                                    >
                                      Sign in with {agent === 'claude' ? 'Claude' : 'Codex'}
                                    </Button>
                                  ))}
                              <Badge
                                variant={
                                  ['global', 'claude', 'codex'].includes(server.scope)
                                    ? 'accent'
                                    : 'default'
                                }
                              >
                                {server.scope.startsWith('project:')
                                  ? 'This project'
                                  : server.scope === 'global'
                                    ? 'Global'
                                    : server.scope}
                              </Badge>
                              <Badge>{server.transport}</Badge>
                              {server.discovery && <Badge>On demand</Badge>}
                            </div>
                          </div>

                          {server.managed && (
                            <p className="task-muted text-xs mb-3">
                              {server.agents
                                ? server.agents
                                    .map(
                                      (id) =>
                                        builtinAgents.find((agent) => agent.id === id)?.name ?? id,
                                    )
                                    .join(' · ')
                                : 'All agents'}
                            </p>
                          )}
                          {server.description && (
                            <p className="mcp-card-description">{server.description}</p>
                          )}

                          <div className="mcp-card-meta">
                            {server.url ? (
                              <span>{server.url}</span>
                            ) : (
                              <span>
                                {server.command} {(server.args || []).join(' ')}
                              </span>
                            )}
                          </div>

                          {envCount > 0 && (
                            <p className="text-xs text-[var(--color-text-muted)] mb-2">
                              🔒 {envCount} environment variable{envCount > 1 ? 's' : ''} configured
                            </p>
                          )}

                          {/* Probe / Status info */}
                          {probe && (
                            <div className="mb-2">
                              {probe.ok ? (
                                <div className="text-xs text-[var(--color-success)] flex items-center gap-1.5 font-medium">
                                  <CheckCircle size={13} />
                                  Checked ({probe.latencyMs ?? 0}ms) · {probe.tools.length} tool
                                  {probe.tools.length === 1 ? '' : 's'} available
                                </div>
                              ) : (
                                <div className="text-xs text-[var(--color-danger)] flex items-center gap-1.5 font-medium">
                                  <X size={13} />
                                  Probe failed: {probe.error || 'Connection error'}
                                </div>
                              )}

                              {probe.ok && probe.tools.length > 0 && (
                                <section aria-label={`${server.name} tools`}>
                                  <h3 className="text-sm font-medium mt-3">Available tools</h3>
                                  <div className="mcp-tools-list">
                                    {probe.tools
                                      .filter(
                                        (tool) =>
                                          !configuredSearch.trim() ||
                                          `${tool.name} ${tool.description ?? ''}`
                                            .toLowerCase()
                                            .includes(configuredSearch.toLowerCase()) ||
                                          `${server.name} ${server.id} ${server.description ?? ''}`
                                            .toLowerCase()
                                            .includes(configuredSearch.toLowerCase()),
                                      )
                                      .map((t) => (
                                        <div key={t.name} className="mcp-tool-item">
                                          <span className="mcp-tool-name">{t.name}</span>
                                          {t.description && (
                                            <span className="mcp-tool-desc">{t.description}</span>
                                          )}
                                        </div>
                                      ))}
                                  </div>
                                </section>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="mcp-card-footer">
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void probeServer(server)}
                              disabled={isProbing}
                              title="Check connection and list tools"
                            >
                              <Activity size={13} className={isProbing ? 'animate-spin' : ''} />
                              {isProbing ? 'Probing…' : 'Check'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void handleCopyJson(server)}
                              title="Copy JSON configuration"
                            >
                              {copiedId === key ? <Check size={13} /> : <Copy size={13} />}
                              <span className="sr-only">
                                {copiedId === key
                                  ? 'Configuration copied'
                                  : `Copy ${server.name} configuration`}
                              </span>
                            </Button>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingServer(server);
                                setCustomModalOpen(true);
                              }}
                              title="Edit server"
                              aria-label={`Edit ${server.name}`}
                            >
                              <Pencil size={13} />
                            </Button>
                            <ConfirmAction
                              title="Remove connection?"
                              description={`Remove ${server.name} from ${server.scope}? You can configure it again later.`}
                              label="Remove connection"
                              onConfirm={() => deleteServer(server.id, server.scope)}
                              trigger={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  aria-label={`Remove ${server.name}`}
                                >
                                  <Trash2 size={13} />
                                </Button>
                              }
                            />
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Tab 2: Marketplace (allmcps.com) */}
          {activeTab === 'marketplace' && (
            <section>
              {!useMcpMarketplace ? (
                <div className="mcp-privacy-banner">
                  <div>
                    <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">
                      MCP Marketplace is currently disabled
                    </h3>
                    <p className="text-xs text-[var(--color-text-muted)] max-w-xl">
                      Marketplace browsing is off. Configured connections remain available to your
                      agents.
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      setUseMcpMarketplace(true);
                      void searchMarketplace(undefined, undefined, true);
                    }}
                  >
                    <Globe size={15} />
                    Enable Marketplace
                  </Button>
                </div>
              ) : (
                <>
                  {/* Search input */}
                  <div className="mcp-search-bar relative">
                    <SearchField
                      className="mcp-search-input"
                      aria-label="Search MCP marketplace"
                      placeholder="Search MCP servers…"
                      value={searchQuery}
                      onValueChange={(value) => setSearchQuery(value)}
                    />
                  </div>

                  {/* Category Pills */}
                  <div className="mcp-category-pills">
                    {CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setSelectedCategory(cat.id)}
                        aria-pressed={selectedCategory === cat.id}
                        className={`mcp-category-btn ${selectedCategory === cat.id ? 'active' : ''}`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>

                  {marketplaceError && (
                    <InlineNotice tone="error" className="mb-4">
                      {marketplaceError}
                    </InlineNotice>
                  )}

                  {loadingMarketplace ? (
                    <div className="p-16 text-center text-[var(--color-text-muted)]">
                      <LoadingIcon
                        size={24}
                        className="mx-auto mb-3 text-[var(--color-accent-ink)]"
                      />
                      Searching allmcps.com registry…
                    </div>
                  ) : marketplaceServers.length === 0 ? (
                    <EmptyState
                      icon={Search}
                      title="No MCP servers found"
                      description="Try another search term or select a different category."
                    />
                  ) : (
                    <div className="mcp-grid">
                      {marketplaceServers.map((item) => (
                        <McpMarketplaceCard
                          key={item.id}
                          server={item}
                          scopes={[
                            ...new Set(
                              servers
                                .filter((s) => s.id.toLowerCase() === item.id.toLowerCase())
                                .map((s) => s.scope),
                            ),
                          ]}
                          onInspect={() => openListing(item)}
                          onConfigure={() => openListing(item, true)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {/* Modals */}
          {customModalOpen && (
            <McpAddCustomModal
              key={editingServer ? `${editingServer.scope}:${editingServer.id}` : 'new'}
              open={customModalOpen}
              onClose={() => {
                setCustomModalOpen(false);
                setEditingServer(null);
              }}
              existingServer={editingServer}
            />
          )}
        </>
      )}
    </WorkspacePage>
  );
}
