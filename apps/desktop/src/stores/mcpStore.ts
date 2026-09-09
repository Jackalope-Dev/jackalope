import { create } from 'zustand';
import { createReadCache } from '../lib/read-cache.ts';
import {
  deleteMcpServer,
  listMcpServers,
  type McpProbeResult,
  type McpServerConfig,
  probeMcpServer,
  saveMcpServer,
} from '../lib/tauri-bridge.ts';
import { useProjectStore } from './projectStore.ts';
import { useSettingsStore } from './settingsStore.ts';

export interface AllMcpsServer {
  id: string;
  name: string;
  description: string;
  category: string | null;
  url: string;
  isOfficial: boolean;
  isVerifiedActive: boolean;
  upvotes: number;
  githubStars: number;
  npmDownloads: number | null;
  qualityScore: number;
  installName: string;
  installConfidence: string;
  installNote: string;
  installKind: 'stdio' | 'remote' | string;
  envVars: string[];
  claudeConfigSnippet?: {
    mcpServers?: Record<
      string,
      {
        command?: string;
        args?: string[];
        url?: string;
        env?: Record<string, string>;
        type?: string;
        [key: string]: unknown;
      }
    >;
  };
  detailUrl?: string;
  markdownUrl?: string;
}

export interface AllMcpsSearchResponse {
  total: number;
  query: string | null;
  category: string | null;
  servers: AllMcpsServer[];
}

export interface AllMcpsDetails {
  description?: string;
  aiOverview?: string | null;
  aiFeatures?: string[];
  aiUseCases?: string[];
  readme?: string | null;
  tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
  toolsSource?: string | null;
  license?: string | null;
  pricingModel?: string | null;
  pricingNotes?: string | null;
  authType?: string | null;
  compatibleClients?: string[];
  maintenanceStatus?: string | null;
  lastCommitAt?: string | null;
  lastCheckedAt?: string | null;
  supportUrl?: string | null;
  websiteUrl?: string | null;
}

const marketplaceCache = createReadCache<AllMcpsServer[]>(5 * 60_000);
const detailsCache = createReadCache<AllMcpsDetails>(5 * 60_000);
const connectionsCache = createReadCache<McpServerConfig[]>(30_000, 8);
let connectionsVersion = 0;
let searchVersion = 0;
let inspectVersion = 0;

interface McpState {
  servers: McpServerConfig[];
  loadingServers: boolean;
  serversError: string | null;
  probeResults: Record<string, McpProbeResult>;
  probingIds: Record<string, boolean>;

  marketplaceServers: AllMcpsServer[];
  loadingMarketplace: boolean;
  marketplaceError: string | null;
  searchQuery: string;
  selectedCategory: string;

  inspectingServer: AllMcpsServer | null;
  inspectingMarkdown: string | null;
  inspectingDetails: AllMcpsDetails | null;
  inspectError: string | null;
  loadingMarkdown: boolean;

  loadServers: (projectId?: string | null, force?: boolean) => Promise<void>;
  saveServer: (server: McpServerConfig) => Promise<void>;
  deleteServer: (id: string, scope: string) => Promise<void>;
  probeServer: (server: McpServerConfig) => Promise<void>;

  setSearchQuery: (q: string) => void;
  setSelectedCategory: (cat: string) => void;
  searchMarketplace: (query?: string, category?: string, force?: boolean) => Promise<void>;
  inspectServer: (server: AllMcpsServer, force?: boolean) => Promise<void>;
  clearInspecting: () => void;
}

export const useMcpStore = create<McpState>((set, get) => ({
  servers: [],
  loadingServers: false,
  serversError: null,
  probeResults: {},
  probingIds: {},

  marketplaceServers: [],
  loadingMarketplace: false,
  marketplaceError: null,
  searchQuery: '',
  selectedCategory: 'all',

  inspectingServer: null,
  inspectingMarkdown: null,
  inspectingDetails: null,
  inspectError: null,
  loadingMarkdown: false,

  loadServers: async (projectId = useProjectStore.getState().activeProjectId, force = false) => {
    const version = ++connectionsVersion;
    const key = projectId ?? '';
    const cached = connectionsCache.peek(key);
    set({ servers: cached ?? [], loadingServers: !cached, serversError: null });
    try {
      const servers = await connectionsCache.read(
        key,
        () => listMcpServers(projectId ?? undefined),
        force,
      );
      if (version !== connectionsVersion || projectId !== useProjectStore.getState().activeProjectId) return;
      set({ servers, loadingServers: false });
    } catch (e) {
      if (version !== connectionsVersion) return;
      set({
        serversError: e instanceof Error ? e.message : String(e),
        loadingServers: false,
      });
    }
  },

  saveServer: async (server: McpServerConfig) => {
    await saveMcpServer(server);
    set({ probeResults: {} });
    connectionsCache.clear();
    await get().loadServers(undefined, true);
  },

  deleteServer: async (id: string, scope: string) => {
    await deleteMcpServer(id, scope);
    set({ probeResults: {} });
    connectionsCache.clear();
    await get().loadServers(undefined, true);
  },

  probeServer: async (server: McpServerConfig) => {
    const key = `${server.scope}:${server.id}`;
    set((s) => ({ probingIds: { ...s.probingIds, [key]: true } }));
    try {
      const result = await probeMcpServer(server);
      set((s) => ({
        probeResults: { ...s.probeResults, [key]: result },
        probingIds: { ...s.probingIds, [key]: false },
      }));
    } catch (e) {
      set((s) => ({
        probeResults: {
          ...s.probeResults,
          [key]: {
            ok: false,
            tools: [],
            error: e instanceof Error ? e.message : String(e),
          },
        },
        probingIds: { ...s.probingIds, [key]: false },
      }));
    }
  },

  setSearchQuery: (searchQuery: string) => set({ searchQuery }),
  setSelectedCategory: (selectedCategory: string) => set({ selectedCategory }),

  searchMarketplace: async (query?: string, category?: string, force = false) => {
    const version = ++searchVersion;
    if (!useSettingsStore.getState().useMcpMarketplace) {
      set({
        marketplaceServers: [],
        loadingMarketplace: false,
        marketplaceError: 'Marketplace access is disabled in settings.',
      });
      return;
    }
    const q = query ?? get().searchQuery;
    const cat = category ?? get().selectedCategory;
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (cat && cat !== 'all') params.set('category', cat);
    params.set('limit', '24');
    const key = params.toString();
    const cached = marketplaceCache.peek(key);
    set({ marketplaceServers: cached ?? [], loadingMarketplace: !cached, marketplaceError: null });
    try {
      const servers = await marketplaceCache.read(
        key,
        async (signal) => {
          const response = await fetch(`https://allmcps.com/api/v1/search?${key}`, { signal });
          if (!response.ok) throw new Error(`Marketplace request failed: HTTP ${response.status}`);
          const data: AllMcpsSearchResponse = await response.json();
          return data.servers || [];
        },
        force,
      );
      if (version !== searchVersion || !useSettingsStore.getState().useMcpMarketplace) return;
      set({ marketplaceServers: servers, loadingMarketplace: false });
    } catch (cause) {
      if (version !== searchVersion) return;
      set({
        marketplaceError: cause instanceof Error ? cause.message : String(cause),
        loadingMarketplace: false,
      });
    }
  },

  inspectServer: async (server: AllMcpsServer, force = false) => {
    const version = ++inspectVersion;
    if (!useSettingsStore.getState().useMcpMarketplace) return;
    const cached = detailsCache.peek(server.id);
    set({
      inspectingServer: server,
      inspectingDetails: cached ?? null,
      inspectingMarkdown: null,
      inspectError: null,
      loadingMarkdown: !cached,
    });
    try {
      const detail = await detailsCache.read(
        server.id,
        async (signal) => {
          const response = await fetch(
            `https://allmcps.com/api/v1/servers/${encodeURIComponent(server.id)}`,
            { signal },
          );
          if (!response.ok)
            throw new Error(`Could not load server details (HTTP ${response.status}).`);
          const data = await response.json();
          if (!data.server || typeof data.server !== 'object')
            throw new Error('The marketplace returned no server details.');
          return data.server as AllMcpsDetails;
        },
        force,
      );
      const text =
        [
          detail.description,
          detail.aiOverview,
          ...(detail.aiFeatures ?? []).map((feature) => `- ${feature}`),
        ]
          .filter(Boolean)
          .join('\n\n') || server.description;
      if (version !== inspectVersion || !useSettingsStore.getState().useMcpMarketplace) return;
      set({ inspectingDetails: detail, inspectingMarkdown: text, loadingMarkdown: false });
    } catch (cause) {
      if (version !== inspectVersion) return;
      set({
        inspectingMarkdown: server.description || 'No additional documentation available.',
        inspectError: cause instanceof Error ? cause.message : String(cause),
        loadingMarkdown: false,
      });
    }
  },

  clearInspecting: () => {
    inspectVersion++;
    set({
      inspectingServer: null,
      inspectingMarkdown: null,
      inspectingDetails: null,
      inspectError: null,
      loadingMarkdown: false,
    });
  },
}));

useSettingsStore.subscribe((state, previous) => {
  if (previous.useMcpMarketplace && !state.useMcpMarketplace) {
    searchVersion++;
    marketplaceCache.clear();
    detailsCache.clear();
    inspectVersion++;
    useMcpStore.setState({
      marketplaceServers: [],
      loadingMarketplace: false,
      inspectingServer: null,
      inspectingMarkdown: null,
      inspectingDetails: null,
      inspectError: null,
      loadingMarkdown: false,
    });
  }
});
