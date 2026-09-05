import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AgentRunnerId } from '../lib/orchestration/types.ts';

const memoryStore: Record<string, string> = {};
const safeStorage = createJSONStorage(() => ({
  getItem: (name: string) => {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(name);
    }
    return memoryStore[name] ?? null;
  },
  setItem: (name: string, value: string) => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(name, value);
    } else {
      memoryStore[name] = value;
    }
  },
  removeItem: (name: string) => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(name);
    } else {
      delete memoryStore[name];
    }
  },
}));

export interface CustomAgentConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  models: {
    id: string;
    name: string;
    description?: string;
  }[];
  description: string;
  enabled: boolean;
  isCustom: true;
}

interface AgentConfigState {
  enabledAgents: Record<string, boolean>;
  allowedModels: Record<string, boolean>;
  defaultMetaAgent: string;
  customAgents: CustomAgentConfig[];

  // Actions
  toggleAgent: (agentId: string, enabled?: boolean) => void;
  toggleModel: (modelId: string, allowed?: boolean) => void;
  setDefaultMetaAgent: (agentId: string) => void;
  addCustomAgent: (agent: Omit<CustomAgentConfig, 'isCustom'>) => void;
  updateCustomAgent: (id: string, patch: Partial<CustomAgentConfig>) => void;
  removeCustomAgent: (id: string) => void;

  // Query helpers
  isAgentEnabled: (agentId: string) => boolean;
  isModelAllowed: (modelId: string) => boolean;
}

export const useAgentConfigStore = create<AgentConfigState>()(
  persist(
    (set, get) => ({
      enabledAgents: {
        codex: true,
        claude: true,
        grok: true,
      },
      allowedModels: {
        // By default, all standard models are allowed
        'claude-3-7-sonnet': true,
        'claude-3-5-sonnet': true,
        'claude-3-5-haiku': true,
        'o3-mini': true,
        'o1': true,
        'gpt-4o': true,
        'grok-3': true,
        'grok-beta': true,
      },
      defaultMetaAgent: 'claude',
      customAgents: [],

      toggleAgent: (agentId, enabled) => {
        set((state) => {
          const current = state.enabledAgents[agentId] ?? true;
          const next = enabled !== undefined ? enabled : !current;
          return {
            enabledAgents: { ...state.enabledAgents, [agentId]: next },
          };
        });
      },

      toggleModel: (modelId, allowed) => {
        set((state) => {
          const current = state.allowedModels[modelId] ?? true;
          const next = allowed !== undefined ? allowed : !current;
          return {
            allowedModels: { ...state.allowedModels, [modelId]: next },
          };
        });
      },

      setDefaultMetaAgent: (agentId) => {
        set({ defaultMetaAgent: agentId });
      },

      addCustomAgent: (agent) => {
        const newAgent: CustomAgentConfig = {
          ...agent,
          isCustom: true,
        };
        set((state) => ({
          customAgents: [...state.customAgents.filter((a) => a.id !== agent.id), newAgent],
          enabledAgents: { ...state.enabledAgents, [agent.id]: true },
        }));
      },

      updateCustomAgent: (id, patch) => {
        set((state) => ({
          customAgents: state.customAgents.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        }));
      },

      removeCustomAgent: (id) => {
        set((state) => {
          const nextEnabled = { ...state.enabledAgents };
          delete nextEnabled[id];
          return {
            customAgents: state.customAgents.filter((a) => a.id !== id),
            enabledAgents: nextEnabled,
            defaultMetaAgent:
              state.defaultMetaAgent === id ? 'claude' : state.defaultMetaAgent,
          };
        });
      },

      isAgentEnabled: (agentId) => {
        return get().enabledAgents[agentId] ?? true;
      },

      isModelAllowed: (modelId) => {
        return get().allowedModels[modelId] ?? true;
      },
    }),
    {
      name: 'jackalope-agent-config-v1',
      storage: safeStorage,
    },
  ),
);
