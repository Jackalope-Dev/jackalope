import {
  Activity,
  Check,
  CheckCircle,
  Copy,
  Download,
  Eye,
  Globe,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Shield,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { McpServerConfig } from '../../lib/tauri-bridge';
import { type AllMcpsServer, useMcpStore } from '../../stores/mcpStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { McpAddCustomModal } from './McpAddCustomModal';
import { McpInstallModal } from './McpInstallModal';
import { McpInspectModal } from './McpInspectModal';
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

export function McpWorkspace() {
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

  const [activeTab, setActiveTab] = useState<'configured' | 'marketplace'>('configured');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [configuredSearch, setConfiguredSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Modals
  const [installServer, setInstallServer] = useState<AllMcpsServer | null>(null);
  const [inspectingServer, setInspectingServer] = useState<AllMcpsServer | null>(null);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  useEffect(() => {
    if (activeTab === 'marketplace' && useMcpMarketplace && marketplaceServers.length === 0) {
      void searchMarketplace();
    }
  }, [activeTab, useMcpMarketplace, marketplaceServers.length, searchMarketplace]);

  // Debounced search for marketplace
  useEffect(() => {
    if (activeTab !== 'marketplace' || !useMcpMarketplace) return;
    const timer = setTimeout(() => {
      void searchMarketplace(searchQuery, selectedCategory);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedCategory, activeTab, useMcpMarketplace, searchMarketplace]);

  const handleCopyJson = async (server: McpServerConfig) => {
    const snippet = {
      mcpServers: {
        [server.id]: server.url
          ? { url: server.url, description: server.description }
          : {
              command: server.command,
              args: server.args,
              env: server.env,
              description: server.description,
            },
      },
    };
    await navigator.clipboard.writeText(JSON.stringify(snippet, null, 2));
    setCopiedId(server.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const filteredServers = servers.filter((s) => {
    if (scopeFilter !== 'all' && s.scope !== scopeFilter) return false;
    if (configuredSearch.trim()) {
      const q = configuredSearch.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.description && s.description.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const getInstalledScope = (allMcpsId: string): string | null => {
    const found = servers.find((s) => s.id.toLowerCase() === allMcpsId.toLowerCase());
    return found ? found.scope : null;
  };

  return (
    <div className="mcp-workspace">
      <WorkspaceHeading
        title="MCP Tools & Marketplace"
        description="Configure Model Context Protocol servers across installed agents or 1-click install from allmcps.com."
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                void loadServers();
                if (useMcpMarketplace && activeTab === 'marketplace') {
                  void searchMarketplace();
                }
              }}
              disabled={loadingServers || loadingMarketplace}
            >
              <RefreshCw size={16} />
              Refresh
            </Button>
            <Button
              onClick={() => {
                setEditingServer(null);
                setCustomModalOpen(true);
              }}
            >
              <Plus size={16} />
              Add Custom MCP
            </Button>
          </div>
        }
      />

      {/* Main Tabs */}
      <div className="mcp-tabs">
        <button
          type="button"
          onClick={() => setActiveTab('configured')}
          className={`mcp-tab-btn ${activeTab === 'configured' ? 'active' : ''}`}
        >
          <Server size={17} />
          <span>Configured MCPs</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-surface-elevated)] border border-[var(--color-border)]">
            {servers.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('marketplace')}
          className={`mcp-tab-btn ${activeTab === 'marketplace' ? 'active' : ''}`}
        >
          <Globe size={17} />
          <span>Marketplace (allmcps.com)</span>
          {useMcpMarketplace && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-[var(--color-success)] border border-emerald-500/20">
              Live
            </span>
          )}
        </button>
      </div>

      {/* Tab 1: Configured MCPs */}
      {activeTab === 'configured' && (
        <section>
          {serversError && (
            <p role="alert" className="task-error mb-4">
              {serversError}
            </p>
          )}

          {/* Scope Filters & Search */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="mcp-scope-filters">
              {[
                { id: 'all', label: `All (${servers.length})` },
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
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setScopeFilter(item.id)}
                  className={`mcp-scope-chip ${scopeFilter === item.id ? 'active' : ''}`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="relative min-w-56">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
              />
              <input
                className="task-input w-full pl-8 py-1.5 text-xs"
                placeholder="Filter configured MCPs…"
                value={configuredSearch}
                onChange={(e) => setConfiguredSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Servers Grid */}
          {filteredServers.length === 0 ? (
            <EmptyState
              icon={Server}
              title={servers.length === 0 ? 'No MCP servers configured' : 'No matching MCP servers'}
              description={
                servers.length === 0
                  ? 'Add a custom MCP server or browse the AllMCPs marketplace to 1-click install tools.'
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
                      <Globe size={15} /> Browse Marketplace
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
                          <span className={`mcp-pill scope-${server.scope}`}>
                            {server.scope === 'global' ? 'Global' : server.scope}
                          </span>
                          <span className="mcp-pill">{server.transport}</span>
                        </div>
                      </div>

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
                              Active ({probe.latencyMs ?? 0}ms) · {probe.tools.length} tool
                              {probe.tools.length === 1 ? '' : 's'} available
                            </div>
                          ) : (
                            <div className="text-xs text-[var(--color-danger)] flex items-center gap-1.5 font-medium">
                              <X size={13} />
                              Probe failed: {probe.error || 'Connection error'}
                            </div>
                          )}

                          {probe.ok && probe.tools.length > 0 && (
                            <div className="mcp-tools-list">
                              {probe.tools.map((t) => (
                                <div key={t.name} className="mcp-tool-item">
                                  <span className="mcp-tool-name">{t.name}</span>
                                  {t.description && (
                                    <span className="mcp-tool-desc">{t.description}</span>
                                  )}
                                </div>
                              ))}
                            </div>
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
                          {copiedId === server.id ? <Check size={13} /> : <Copy size={13} />}
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
                        >
                          <Pencil size={13} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="hover:text-[var(--color-danger)]"
                          onClick={() => {
                            if (
                              confirm(`Remove MCP server '${server.name}' from ${server.scope}?`)
                            ) {
                              void deleteServer(server.id, server.scope);
                            }
                          }}
                          title="Delete server"
                        >
                          <Trash2 size={13} />
                        </Button>
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
                  You opted out of online registry access. Jackalope is operating in local-only mode
                  and does not send requests to allmcps.com.
                </p>
              </div>
              <Button
                onClick={() => {
                  setUseMcpMarketplace(true);
                  void searchMarketplace();
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
                <Search
                  size={16}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
                />
                <input
                  className="mcp-search-input"
                  placeholder="Search 10,000+ MCP servers (e.g. postgres, github, playwright, docker)…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              {/* Category Pills */}
              <div className="mcp-category-pills">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`mcp-category-btn ${selectedCategory === cat.id ? 'active' : ''}`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {marketplaceError && (
                <p role="alert" className="task-error mb-4">
                  {marketplaceError}
                </p>
              )}

              {loadingMarketplace ? (
                <div className="p-16 text-center text-[var(--color-text-muted)]">
                  <RefreshCw
                    size={24}
                    className="animate-spin mx-auto mb-3 text-[var(--color-accent-ink)]"
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
                  {marketplaceServers.map((item) => {
                    const installedScope = getInstalledScope(item.id);
                    const requiresEnv = item.envVars && item.envVars.length > 0;

                    return (
                      <article key={item.id} className="mcp-card">
                        <div>
                          <div className="mcp-card-header">
                            <div>
                              <h3 className="mcp-card-title">{item.name}</h3>
                              {item.category && (
                                <span className="text-xs text-[var(--color-text-muted)]">
                                  {item.category}
                                </span>
                              )}
                            </div>
                            <div className="mcp-card-badges">
                              {item.isOfficial && (
                                <span className="mcp-pill official flex items-center gap-0.5">
                                  <Shield size={10} /> Official
                                </span>
                              )}
                              {item.isVerifiedActive && (
                                <span className="mcp-pill verified flex items-center gap-0.5">
                                  <CheckCircle size={10} /> Verified
                                </span>
                              )}
                              {item.githubStars > 0 && (
                                <span className="mcp-pill flex items-center gap-0.5">
                                  <Star size={10} className="text-[var(--color-warning)]" />{' '}
                                  {item.githubStars.toLocaleString()}
                                </span>
                              )}
                            </div>
                          </div>

                          <p className="mcp-card-description">{item.description}</p>

                          <div className="mcp-card-meta">
                            <span>
                              {item.installKind === 'remote'
                                ? 'remote url'
                                : item.installName || item.id}
                            </span>
                          </div>

                          {requiresEnv && (
                            <p className="text-xs text-[var(--color-warning)] mb-2">
                              🔑 Requires {item.envVars.join(', ')}
                            </p>
                          )}

                          {installedScope && (
                            <div className="mb-2">
                              <span className="text-xs font-medium text-[var(--color-success)] flex items-center gap-1">
                                <Check size={13} /> Installed ({installedScope})
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="mcp-card-footer">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              void inspectServer(item);
                              setInspectingServer(item);
                            }}
                          >
                            <Eye size={14} />
                            Inspect
                          </Button>

                          <Button size="sm" onClick={() => setInstallServer(item)}>
                            <Download size={14} />
                            {installedScope ? 'Reconfigure' : '1-Click Install'}
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* Modals */}
      <McpInstallModal
        server={installServer}
        open={!!installServer}
        onClose={() => setInstallServer(null)}
      />

      <McpInspectModal
        server={inspectingServer}
        open={!!inspectingServer}
        onClose={() => setInspectingServer(null)}
        onInstall={(srv) => setInstallServer(srv)}
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
    </div>
  );
}
