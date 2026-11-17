import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type BuiltinAgentId,
  builtinAgents,
  catalogEntry,
  getAgentMetadata,
} from '../lib/agent-catalog.ts';
import { isTauriEnvironment } from '../lib/native/env.ts';
import { awaitBeforeNative, invokeNative } from '../lib/native/transport.ts';
import { createPersistStorage } from '../lib/persist-storage.ts';
import { isMainWindow } from '../lib/window-kind.ts';
import { isAgentAllowedForProject, useProjectStore } from './projectStore.ts';

interface CustomAgentConfig {
  id: string;
  name: string;
  command: string;
  adapter?: BuiltinAgentId | 'acp';
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

/** Commands whose native side reads the agent policy; each waits until it holds the latest. */
const POLICY_COMMANDS = [
  'task_start',
  'task_start_agent_review',
  'task_start_challenge',
  'task_runners',
  'task_validate_project',
  'task_create_project',
  'task_strategy_assess',
  'task_plan_create',
  'queue_dispatch',
  'queue_add',
  'queue_import',
  'schedule_save',
  'live_session_create',
  'helper_send',
  'remote_configure',
  'cloudflare_artifacts_create_project',
];

function agentPolicy() {
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
  return {
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
  };
}

let saved: string | null = null;
let saving: Promise<void> = Promise.resolve();
/** Queues a save of the current policy; `always` saves even when it matches the last save. */
function saveAgentPolicy(always: boolean) {
  saving = saving
    .catch(() => {})
    .then(async () => {
      const policy = agentPolicy();
      const encoded = JSON.stringify(policy);
      if (!always && encoded === saved) return;
      await invokeNative('agent_save_policy', { policy });
      saved = encoded;
    });
  return saving;
}

/** An agent's display name: a saved custom agent's own name, the catalog name, or its id. */
export function agentName(agent: string) {
  return (
    useAgentConfigStore.getState().customAgents.find((a) => a.id === agent)?.name ??
    getAgentMetadata(agent)?.name ??
    agent
  );
}

/** The brand name alone, as in "Sign in with Claude". */
export function agentShortName(agent: string) {
  return catalogEntry(agent)?.shortName ?? agentName(agent);
}

/**
 * Resolves once the native side holds the current agent policy, rejecting with
 * the save's error. Settings screens await it to report or roll back a change.
 */
export const agentPolicySaved = () => saveAgentPolicy(false);

// A terminal or another window can also write the policy, so every command that
// reads it saves this window's copy again rather than trusting the last save.
awaitBeforeNative(POLICY_COMMANDS, () => saveAgentPolicy(true));

// The main window also saves each change, so background work such as schedules
// sees it; secondary windows save only before their own commands.
if (isMainWindow()) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (isTauriEnvironment()) void saveAgentPolicy(false).catch(() => {});
    }, 300);
  };
  useAgentConfigStore.subscribe(changed);
  useProjectStore.subscribe(changed);
}
