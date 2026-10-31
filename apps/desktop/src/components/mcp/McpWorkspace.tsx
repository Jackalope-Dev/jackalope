import { Badge, LoadingIcon, DropdownMenu as Menu, SearchField, SegmentedNav } from '@jackalope/ui';
import { Activity, CheckCircle, Globe, MoreHorizontal, Search, Server, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { builtinAgents } from '../../lib/agent-catalog';
import { connectionFailure, redactConnection } from '../../lib/mcp-connection';
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
import {
  recommendationFor,
  recommendationGroups,
  recommendedMatches,
  recommendedServers,
} from './curated-servers';
import { McpAddCustomModal } from './McpAddCustomModal';
import { McpMarketplaceCard } from './McpMarketplaceCard';
import { McpServerPage } from './McpServerPage';
import './mcp.css';

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'databases', label: 'Databases' },
  { id: 'search-and-data-extraction', label: 'Search & web' },
  { id: 'developer-tools', label: 'Dev tools' },
  { id: 'version-control', label: 'Git' },
  { id: 'cloud-platforms', label: 'Cloud' },
  { id: 'knowledge-and-memory', label: 'Memory' },
  { id: 'communication', label: 'Team chat' },
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
  } = useMcpStore(
    useShallow((s) => ({
      servers: s.servers,
      loadingServers: s.loadingServers,
      serversError: s.serversError,
      probeResults: s.probeResults,
      probingIds: s.probingIds,
      marketplaceServers: s.marketplaceServers,
      loadingMarketplace: s.loadingMarketplace,
      marketplaceError: s.marketplaceError,
      searchQuery: s.searchQuery,
      selectedCategory: s.selectedCategory,
      loadServers: s.loadServers,
      deleteServer: s.deleteServer,
      probeServer: s.probeServer,
      setSearchQuery: s.setSearchQuery,
      setSelectedCategory: s.setSelectedCategory,
      searchMarketplace: s.searchMarketplace,
      inspectServer: s.inspectServer,
    })),
  );

  const { useMcpMarketplace, setUseMcpMarketplace } = useSettingsStore(
    useShallow((s) => ({
      useMcpMarketplace: s.useMcpMarketplace,
      setUseMcpMarketplace: s.setUseMcpMarketplace,
    })),
  );

  const [localTab, setLocalTab] = useState<'configured' | 'marketplace'>('configured');
  const activeTab = view ?? localTab;
  const setActiveTab = (next: 'configured' | 'marketplace') => {
    setLocalTab(next);
    onViewChange?.(next);
  };
  const [directory, setDirectory] = useState(false);
  const showDirectory = directory || !!searchQuery.trim();
  const [scopeFilter, setScopeFilter] = useState('all');
  const [configuredSearch, setConfiguredSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState('');
  const [noticeTone, setNoticeTone] = useState<'error' | 'info'>('error');

  // Modals
  const [initialConfigure, setInitialConfigure] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  const returnTo = useRef<{ top: number; id: string; configure: boolean } | null>(null);
  const [inspectingServer, setInspectingServer] = useState<AllMcpsServer | null>(null);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null);
  const [removing, setRemoving] = useState<McpServerConfig | null>(null);

  useEffect(() => {
    void loadServers(activeProjectId);
  }, [loadServers, activeProjectId]);

  // Debounced search for marketplace
  useEffect(() => {
    if (activeTab !== 'marketplace' || !useMcpMarketplace || !showDirectory) return;
    const timer = setTimeout(() => {
      void searchMarketplace(searchQuery, selectedCategory);
    }, 300);
    return () => clearTimeout(timer);
  }, [
    searchQuery,
    selectedCategory,
    activeTab,
    useMcpMarketplace,
    searchMarketplace,
    showDirectory,
  ]);

  const openListing = (server: AllMcpsServer, configure = false) => {
    returnTo.current = { top: workspace.current?.scrollTop ?? 0, id: server.id, configure };
    setInitialConfigure(configure);
    setInspectingServer(server);
    if (!recommendationFor(server.id)) void inspectServer(server);
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
    const snippet = redactConnection(server);
    try {
      await navigator.clipboard.writeText(JSON.stringify(snippet, null, 2));
      setCopiedId(`${server.scope}:${server.id}`);
      setCopyError('');
    } catch {
      setNoticeTone('error');
      setCopyError(
        'Could not copy the configuration. Open Edit to inspect the connection settings.',
      );
    }
  };

  const signIn = (server: McpServerConfig, agent: string) =>
    void nativeTask('mcp_authenticate', {
      id: server.id,
      scope: server.scope,
      agent,
      profileId: agentAccountFor(project, agent),
    })
      .then(() => {
        setNoticeTone('info');
        setCopyError(
          'Sign-in opened in your CLI. Complete authorization and check access there. Connection probes use configured headers or environment tokens.',
        );
      })
      .catch(() => {
        setNoticeTone('error');
        setCopyError(
          'Could not open sign-in. Use the selected agent account’s MCP sign-in flow in a terminal.',
        );
      });

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

  const showConnections = () => {
    setInspectingServer(null);
    useMcpStore.getState().clearInspecting();
    setActiveTab('configured');
  };
  const renderCard = (item: AllMcpsServer) => {
    const server = recommendedServers.find((preset) => preset.id === item.id) ?? item;
    const scopes = [
      ...new Set(
        servers
          .filter((saved) => saved.id.toLowerCase() === server.id.toLowerCase())
          .map((saved) => saved.scope),
      ),
    ];
    return (
      <McpMarketplaceCard
        key={server.id}
        server={server}
        scopes={scopes}
        onInspect={() => openListing(server)}
        onConfigure={() => (scopes.length ? showConnections() : openListing(server, true))}
      />
    );
  };
  const matchingRecommendations = recommendedMatches(searchQuery);
  const directoryResults = marketplaceServers.filter(
    (item) =>
      selectedCategory !== 'all' ||
      !matchingRecommendations.some((preset) => preset.id === item.id),
  );

  return (
    <WorkspacePage className="mcp-workspace" ref={workspace}>
      {inspectingServer && activeTab === 'marketplace' && useMcpMarketplace ? (
        <McpServerPage
          key={inspectingServer.id}
          server={inspectingServer}
          initialConfigure={initialConfigure}
          onDone={showConnections}
          onClose={() => {
            setInspectingServer(null);
            useMcpStore.getState().clearInspecting();
          }}
        />
      ) : (
        <>
          <WorkspaceHeading
            title={activeTab === 'configured' ? 'Tools' : 'Tool marketplace'}
            action={
              <div className="workspace-actions">
                {activeTab === 'configured' && (
                  <Button onClick={() => setActiveTab('marketplace')}>
                    <Globe size={16} />
                    Add tools
                  </Button>
                )}
                <Menu.Root>
                  <Menu.Trigger asChild>
                    <Button variant="outline" aria-label="Connection options">
                      <MoreHorizontal size={16} aria-hidden="true" />
                    </Button>
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Content className="workspace-menu" align="end" sideOffset={6}>
                      <Menu.Item
                        className="workspace-menu-item"
                        onSelect={() => {
                          setEditingServer(null);
                          setCustomModalOpen(true);
                        }}
                      >
                        Custom connection
                      </Menu.Item>
                      <Menu.Item
                        className="workspace-menu-item"
                        disabled={loadingServers || loadingMarketplace}
                        onSelect={() => {
                          void loadServers(undefined, true);
                          if (useMcpMarketplace && activeTab === 'marketplace' && showDirectory) {
                            void searchMarketplace(undefined, undefined, true);
                          }
                        }}
                      >
                        Refresh
                      </Menu.Item>
                    </Menu.Content>
                  </Menu.Portal>
                </Menu.Root>
              </div>
            }
          />
          {copyError && (
            <InlineNotice tone={noticeTone} className="mb-4">
              {copyError}
            </InlineNotice>
          )}

          {!view && (
            <SegmentedNav
              className="mcp-tabs"
              label="MCP views"
              value={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  id: 'configured',
                  label: (
                    <>
                      <Server size={16} aria-hidden="true" />
                      Connections
                    </>
                  ),
                  count: servers.length,
                },
                {
                  id: 'marketplace',
                  label: (
                    <>
                      <Globe size={16} aria-hidden="true" />
                      Marketplace
                    </>
                  ),
                },
              ]}
            />
          )}

          {activeTab === 'configured' && (
            <section>
              {serversError && (
                <InlineNotice tone="error" className="mb-4">
                  {serversError}
                </InlineNotice>
              )}

              <WorkspaceToolbar className="mb-4">
                <FilterGroup
                  label="Connection scope"
                  value={scopeFilter}
                  onChange={setScopeFilter}
                  items={[
                    { id: 'all', label: 'All', count: servers.length },
                    ...(activeProjectId
                      ? [
                          {
                            id: `project:${activeProjectId}`,
                            label: 'This project',
                            count: servers.filter((s) => s.scope === `project:${activeProjectId}`)
                              .length,
                          },
                        ]
                      : []),
                    ...(
                      [
                        ['global', 'Global'],
                        ['claude', 'Claude Code'],
                        ['codex', 'Codex'],
                        ['grok', 'Grok'],
                      ] as const
                    ).map(([id, label]) => ({
                      id,
                      label,
                      count: servers.filter((s) => s.scope === id).length,
                    })),
                  ]}
                />

                <SearchField
                  aria-label="Filter connections"
                  placeholder="Filter connections or checked tools…"
                  value={configuredSearch}
                  onValueChange={(value) => setConfiguredSearch(value)}
                  containerClassName="relative min-w-56"
                />
              </WorkspaceToolbar>

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
                    servers.length === 0 ? undefined : 'Choose another scope or clear the filter.'
                  }
                  action={
                    servers.length === 0 ? (
                      <Button onClick={() => setActiveTab('marketplace')}>
                        <Globe size={15} /> Browse marketplace
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <div className="mcp-grid">
                  {filteredServers.map((server) => {
                    const key = `${server.scope}:${server.id}`;
                    const probe = probeResults[key];
                    const isProbing = !!probingIds[key];
                    const signInAgents =
                      !server.discovery &&
                      server.transport === 'http' &&
                      (server.scope === 'codex' ||
                        server.scope === 'claude' ||
                        server.scope.startsWith('project:') ||
                        server.scope === 'global')
                        ? (server.scope === 'codex' || server.scope === 'claude'
                            ? [server.scope]
                            : ['codex', 'claude']
                          ).filter((agent) => !server.agents || server.agents.includes(agent))
                        : [];

                    return (
                      <article key={key} className="mcp-card">
                        <div>
                          <div className="mcp-card-header">
                            <h3 className="mcp-card-title">{server.name}</h3>
                            <div className="mcp-card-badges">
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
                              {server.enabled === false && <Badge>Disabled</Badge>}
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
                                  {connectionFailure(probe.error).title}.{' '}
                                  {connectionFailure(probe.error).detail}
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
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void probeServer(server)}
                            disabled={isProbing}
                            title="Check connection and list tools"
                            loading={isProbing}
                            loadingLabel="Probing…"
                          >
                            <Activity size={13} />
                            Check
                          </Button>

                          <Menu.Root>
                            <Menu.Trigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`${server.name} options`}
                              >
                                <MoreHorizontal size={16} aria-hidden="true" />
                              </Button>
                            </Menu.Trigger>
                            <Menu.Portal>
                              <Menu.Content className="workspace-menu" align="end" sideOffset={6}>
                                {signInAgents.map((agent) => (
                                  <Menu.Item
                                    key={agent}
                                    className="workspace-menu-item"
                                    onSelect={() => signIn(server, agent)}
                                  >
                                    Sign in with {agent === 'claude' ? 'Claude' : 'Codex'}
                                  </Menu.Item>
                                ))}
                                <Menu.Item
                                  className="workspace-menu-item"
                                  onSelect={() => {
                                    setEditingServer(server);
                                    setCustomModalOpen(true);
                                  }}
                                >
                                  Edit
                                </Menu.Item>
                                <Menu.Item
                                  className="workspace-menu-item"
                                  onSelect={() => void handleCopyJson(server)}
                                >
                                  {copiedId === key
                                    ? 'Configuration copied'
                                    : 'Copy redacted configuration'}
                                </Menu.Item>
                                <Menu.Separator className="menu-separator" />
                                <Menu.Item
                                  className="workspace-menu-item"
                                  onSelect={() => setRemoving(server)}
                                >
                                  Remove…
                                </Menu.Item>
                              </Menu.Content>
                            </Menu.Portal>
                          </Menu.Root>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {activeTab === 'marketplace' && (
            <section>
              {!useMcpMarketplace ? (
                <div className="mcp-privacy-banner">
                  <div>
                    <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
                      MCP Marketplace is currently disabled
                    </h3>
                  </div>
                  <Button
                    onClick={() => {
                      setUseMcpMarketplace(true);
                    }}
                  >
                    <Globe size={15} />
                    Enable Marketplace
                  </Button>
                </div>
              ) : (
                <>
                  <div className="mcp-search-bar relative">
                    <SearchField
                      aria-label="Search MCP marketplace"
                      placeholder="Search MCP servers…"
                      value={searchQuery}
                      onValueChange={(value) => setSearchQuery(value)}
                    />
                  </div>

                  <div className="mcp-browse-controls">
                    <FilterGroup
                      label="Marketplace collection"
                      value={directory ? 'directory' : 'recommended'}
                      onChange={(value) => {
                        setDirectory(value === 'directory');
                        setSelectedCategory('all');
                        if (value === 'recommended') setSearchQuery('');
                      }}
                      items={[
                        { id: 'recommended', label: 'Recommended' },
                        { id: 'directory', label: 'All servers' },
                      ]}
                    />
                    {showDirectory && (
                      <p className="task-muted">
                        Search results are supplied by AllMCPs. Review the publisher before
                        connecting.
                      </p>
                    )}
                  </div>
                  {!showDirectory ? (
                    recommendationGroups.map((group) => (
                      <section className="mcp-recommendation-group" key={group} aria-label={group}>
                        <h2>{group}</h2>
                        <div className="mcp-grid">
                          {recommendedServers
                            .filter((item) => recommendationFor(item.id)?.group === group)
                            .map(renderCard)}
                        </div>
                      </section>
                    ))
                  ) : (
                    <>
                      {directory && (
                        <FilterGroup
                          className="mcp-category-filter"
                          label="Category"
                          value={selectedCategory}
                          onChange={setSelectedCategory}
                          items={CATEGORIES}
                        />
                      )}
                      {selectedCategory === 'all' && matchingRecommendations.length > 0 && (
                        <section
                          className="mcp-recommendation-group"
                          aria-label="Recommended matches"
                        >
                          <h2>Recommended{searchQuery.trim() ? ' matches' : ''}</h2>
                          <div className="mcp-grid">{matchingRecommendations.map(renderCard)}</div>
                        </section>
                      )}
                      <section className="mcp-recommendation-group" aria-label="AllMCPs directory">
                        <h2>From AllMCPs</h2>
                        {marketplaceError && (
                          <InlineNotice tone="warning" className="mb-4">
                            The directory could not be loaded. Recommended tools and custom
                            connections are still available.{' '}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void searchMarketplace(undefined, undefined, true)}
                            >
                              Retry search
                            </Button>
                          </InlineNotice>
                        )}
                        {loadingMarketplace ? (
                          <p className="task-muted" role="status">
                            <LoadingIcon size={16} /> Searching AllMCPs…
                          </p>
                        ) : directoryResults.length > 0 ? (
                          <div className="mcp-grid">{directoryResults.map(renderCard)}</div>
                        ) : (
                          !marketplaceError && (
                            <EmptyState
                              icon={Search}
                              title="No additional servers found"
                              description="Try another search term or category."
                            />
                          )
                        )}
                      </section>
                    </>
                  )}
                </>
              )}
            </section>
          )}

          <ConfirmAction
            open={!!removing}
            onOpenChange={(open) => {
              if (!open) setRemoving(null);
            }}
            title="Remove connection?"
            description={
              removing
                ? `Remove ${removing.name} from ${removing.scope}? You can configure it again later.`
                : ''
            }
            label="Remove connection"
            onConfirm={() => (removing ? deleteServer(removing.id, removing.scope) : undefined)}
          />
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
