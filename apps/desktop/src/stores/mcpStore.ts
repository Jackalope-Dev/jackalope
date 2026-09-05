import { create } from 'zustand';
import {
  type McpProbeResult,
  type McpServerConfig,
  deleteMcpServer,
  listMcpServers,
  probeMcpServer,
  saveMcpServer,
} from '../lib/tauri-bridge.ts';
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

let searchController: AbortController | undefined;
let inspectController: AbortController | undefined;

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
  loadingMarkdown: boolean;

  loadServers: () => Promise<void>;
  saveServer: (server: McpServerConfig) => Promise<void>;
  deleteServer: (id: string, scope: string) => Promise<void>;
  probeServer: (server: McpServerConfig) => Promise<void>;

  setSearchQuery: (q: string) => void;
  setSelectedCategory: (cat: string) => void;
  searchMarketplace: (query?: string, category?: string) => Promise<void>;
  inspectServer: (server: AllMcpsServer) => Promise<void>;
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
  loadingMarkdown: false,

  loadServers: async () => {
    set({ loadingServers: true, serversError: null });
    try {
      const servers = await listMcpServers();
      set({ servers, loadingServers: false });
    } catch (e) {
      set({
        serversError: e instanceof Error ? e.message : String(e),
        loadingServers: false,
      });
    }
  },

  saveServer: async (server: McpServerConfig) => {
    await saveMcpServer(server);
    set({ probeResults: {} });
    await get().loadServers();
  },

  deleteServer: async (id: string, scope: string) => {
    await deleteMcpServer(id, scope);
    set({ probeResults: {} });
    await get().loadServers();
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

  searchMarketplace: async (query?: string, category?: string) => {
    searchController?.abort();
    const controller = new AbortController();
    searchController = controller;
    const enabled = useSettingsStore.getState().useMcpMarketplace;
    if (!enabled) {
      set({
        marketplaceServers: [],
        loadingMarketplace: false,
        marketplaceError: 'Marketplace access is disabled in settings.',
      });
      return;
    }

    set({ loadingMarketplace: true, marketplaceError: null });
    try {
      const q = query !== undefined ? query : get().searchQuery;
      const cat = category !== undefined ? category : get().selectedCategory;

      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (cat && cat !== 'all') params.set('category', cat);
      params.set('limit', '24');

      const url = `https://allmcps.com/api/v1/search?${params.toString()}`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Marketplace request failed: HTTP ${res.status}`);
      }
      const data: AllMcpsSearchResponse = await res.json();
      if (controller.signal.aborted || !useSettingsStore.getState().useMcpMarketplace) return;
      set({
        marketplaceServers: data.servers || [],
        loadingMarketplace: false,
      });
    } catch (e) {
      if (controller.signal.aborted) return;
      set({
        marketplaceError: e instanceof Error ? e.message : String(e),
        loadingMarketplace: false,
      });
    }
  },

  inspectServer: async (server: AllMcpsServer) => {
    inspectController?.abort();
    if (!useSettingsStore.getState().useMcpMarketplace) return;
    const controller = new AbortController();
    inspectController = controller;
    set({ inspectingServer: server, inspectingMarkdown: null, loadingMarkdown: true });
    try {
      const res = await fetch(
        `https://allmcps.com/api/v1/servers/${encodeURIComponent(server.id)}`,
        { signal: controller.signal },
      );
      if (res.ok) {
        const data = await res.json();
        const detail = data.server;
        const text =
          [
            detail?.description,
            detail?.aiOverview,
            ...(detail?.aiFeatures ?? []).map((feature: string) => `- ${feature}`),
          ]
            .filter(Boolean)
            .join('\n\n') || server.description;
        if (controller.signal.aborted || !useSettingsStore.getState().useMcpMarketplace) return;
        set({ inspectingMarkdown: text, loadingMarkdown: false });
      } else {
        set({
          inspectingMarkdown: server.description || 'No additional documentation available.',
          loadingMarkdown: false,
        });
      }
    } catch {
      if (controller.signal.aborted) return;
      set({
        inspectingMarkdown: server.description || 'No additional documentation available.',
        loadingMarkdown: false,
      });
    }
  },

  clearInspecting: () => {
    inspectController?.abort();
    set({ inspectingServer: null, inspectingMarkdown: null, loadingMarkdown: false });
  },
}));

useSettingsStore.subscribe((state, previous) => {
  if (previous.useMcpMarketplace && !state.useMcpMarketplace) {
    searchController?.abort();
    inspectController?.abort();
    useMcpStore.setState({
      marketplaceServers: [],
      loadingMarketplace: false,
      inspectingServer: null,
      inspectingMarkdown: null,
      loadingMarkdown: false,
    });
  }
});
