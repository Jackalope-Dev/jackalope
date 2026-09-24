import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type BuiltinAgentId, builtinAgents } from '../lib/agent-catalog.ts';
import { createPersistStorage } from '../lib/persist-storage.ts';
import { nativeTask } from '../lib/task-runtime.ts';
import { isAgentAllowedForProject, useProjectStore } from './projectStore.ts';

export interface CustomAgentConfig {
  id: string;
  name: string;
  command: string;
  adapter?: BuiltinAgentId;
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
  runnerOptions: Record<
    string,
    { command?: string; models: string[]; restrictModels: boolean; defaultModel: string }
  >;
  setRunnerOptions: (id: string, options: AgentConfigState['runnerOptions'][string]) => void;
  enabledAgents: Record<string, boolean>;
  disabledAccounts: Record<string, string[]>;
  allowedModels: Record<string, boolean>;
  defaultMetaAgent: string;
  automaticQuotaHandoff: boolean;
  customAgents: CustomAgentConfig[];

  toggleAgent: (agentId: string, enabled?: boolean, projectId?: string) => void;
  toggleModel: (modelId: string, allowed?: boolean) => void;
  setDefaultMetaAgent: (agentId: string, projectId?: string) => void;
  addCustomAgent: (agent: Omit<CustomAgentConfig, 'isCustom'>) => void;
  updateCustomAgent: (id: string, patch: Partial<CustomAgentConfig>) => void;
  removeCustomAgent: (id: string) => void;

  isAgentEnabled: (agentId: string, projectId?: string) => boolean;
  isModelAllowed: (modelId: string) => boolean;
}

export const useAgentConfigStore = create<AgentConfigState>()(
  persist(
    (set, get) => ({
      runnerOptions: {},
      setRunnerOptions: (id, options) =>
        set((state) => ({ runnerOptions: { ...state.runnerOptions, [id]: options } })),
      disabledAccounts: {},
      enabledAgents: {
        codex: true,
        claude: true,
        grok: true,
        opencode: true,
        kimi: true,
        antigravity: true,
      },
      allowedModels: {},
      defaultMetaAgent: 'codex',
      automaticQuotaHandoff: true,
      customAgents: [],

      toggleAgent: (agentId, enabled, projectId) => {
        if (projectId) {
          const store = useProjectStore.getState();
          const project = store.projects.find((item) => item.id === projectId);
          if (!project) throw new Error('This project is no longer available.');
          const next = enabled ?? !get().isAgentEnabled(agentId, projectId);
          if (next && !get().isAgentEnabled(agentId))
            throw new Error('Enable this agent in app settings first.');
          const current =
            project.preferences?.allowedAgents ??
            [...builtinAgents, ...get().customAgents]
              .filter((agent) => get().isAgentEnabled(agent.id))
              .map((agent) => agent.id);
          store.updateProjectPreferences(projectId, {
            allowedAgents: next
              ? [...new Set([...current, agentId])]
              : current.filter((id) => id !== agentId),
            ...(!next && project.preferences?.preferredRunner === agentId
              ? { preferredRunner: undefined }
              : {}),
          });
          return;
        }
        set((state) => {
          const current = state.enabledAgents[agentId] ?? true;
          const next = enabled !== undefined ? enabled : !current;
          return {
            enabledAgents: { ...state.enabledAgents, [agentId]: next },
            defaultMetaAgent:
              !next && state.defaultMetaAgent === agentId ? '' : state.defaultMetaAgent,
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

      setDefaultMetaAgent: (agentId, projectId) => {
        if (!get().isAgentEnabled(agentId, projectId))
          throw new Error('Enable this agent before making it the default.');
        if (projectId) {
          useProjectStore
            .getState()
            .updateProjectPreferences(projectId, { preferredRunner: agentId });
          return;
        }
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
            defaultMetaAgent: state.defaultMetaAgent === id ? '' : state.defaultMetaAgent,
          };
        });
      },

      isAgentEnabled: (agentId, projectId) => {
        const project = useProjectStore.getState().projects.find((item) => item.id === projectId);
        return (
          (get().enabledAgents[agentId] ?? true) &&
          (!projectId || (!!project && isAgentAllowedForProject(project, agentId)))
        );
      },

      isModelAllowed: (modelId) => {
        return get().allowedModels[modelId] ?? true;
      },
    }),
    {
      name: 'jackalope-agent-config-v1',
      storage: createPersistStorage(),
    },
  ),
);

let policySync: Promise<void> = Promise.resolve();
export function syncAgentConfig() {
  policySync = policySync.catch(() => {}).then(syncAgentConfigNow);
  return policySync;
}

async function syncAgentConfigNow() {
  const {
    enabledAgents,
    allowedModels,
    defaultMetaAgent,
    automaticQuotaHandoff,
    disabledAccounts,
    customAgents,
    runnerOptions,
  } = useAgentConfigStore.getState();
  const effectiveOptions = { ...runnerOptions };
  for (const custom of customAgents) {
    const options = effectiveOptions[custom.id];
    effectiveOptions[custom.id] = {
      ...options,
      models: options?.restrictModels
        ? options.models
        : [...(options?.models ?? []), ...custom.models.map((model) => model.id)],
      restrictModels: options?.restrictModels ?? false,
      defaultModel: options?.defaultModel ?? '',
    };
  }
  const normalizedOptions = Object.fromEntries(
    Object.entries(effectiveOptions).map(([id, options]) => [
      id,
      {
        ...options,
        models: [...new Set(options.models.map((m) => m.trim()).filter(Boolean))],
        defaultModel: options.defaultModel.trim(),
        command: options.command?.trim(),
      },
    ]),
  );
  await nativeTask('agent_save_policy', {
    policy: {
      enabledAgents,
      allowedModels,
      defaultMetaAgent,
      automaticQuotaHandoff,
      disabledAccounts,
      customAgents,
      runnerOptions: normalizedOptions,
      projects: Object.fromEntries(
        useProjectStore.getState().projects.map((project) => [
          project.id,
          {
            allowedAgents: project.preferences?.allowedAgents,
            disabledAccounts: project.preferences?.disabledAccounts ?? {},
            agentAccounts: project.preferences?.agentAccounts ?? {},
            preferredRunner: project.preferences?.preferredRunner,
          },
        ]),
      ),
    },
  });
}
