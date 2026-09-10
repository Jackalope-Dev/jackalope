import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { observeRefresh } from '../lib/observe-refresh';
import { nativeTask, type RunUsage } from '../lib/task-runtime';
import { isTauriEnvironment } from '../lib/tauri-bridge';
import { syncAgentConfig, useAgentConfigStore } from './agentConfigStore';
import { useExecutionStore } from './executionStore';
import { useProjectStore } from './projectStore';
import { useSettingsStore } from './settingsStore';
import { useThemeStore } from './themeStore';

export interface HelperTurn {
  id: string;
  prompt: string;
  answer: string;
  status: string;
  agent: string;
  account: string;
  model: string | null;
  usage: RunUsage;
  steps: string[];
}
export interface HelperAction {
  id: string;
  operation: string;
  arguments: { input: Record<string, unknown>; expected: Record<string, unknown> };
  source: string;
  status: string;
  createdAt: number;
  result: unknown;
}
export interface HelperView {
  turns: HelperTurn[];
  actions: HelperAction[];
  connected: boolean;
  error: string | null;
}
interface HelperState {
  view: HelperView;
  draft: string;
  screen: string;
  sharePreferences: boolean;
  shareProjects: boolean;
  error: string | null;
  syncError: string | null;
  sending: boolean;
  send: () => Promise<void>;
  refresh: () => Promise<void>;
}
let syncedContext = '';
let syncedAt = 0;
let syncing: Promise<void> | undefined;
async function syncHelperContext(force = false): Promise<void> {
  if (syncing) {
    await syncing;
    return syncHelperContext(force);
  }
  const context = helperContext();
  const signature = JSON.stringify(context);
  if (!force && signature === syncedContext && Date.now() - syncedAt < 8000) return;
  syncing = nativeTask<void>('helper_sync', {
    context: signature === syncedContext && !force ? null : context,
  });
  try {
    await syncing;
    syncedContext = signature;
    syncedAt = Date.now();
  } finally {
    syncing = undefined;
  }
}
export const useHelperStore = create<HelperState>()(
  persist(
    (set, get) => ({
      view: { turns: [], actions: [], connected: false, error: null },
      draft: '',
      screen: 'tasks',
      sharePreferences: true,
      shareProjects: true,
      error: null,
      syncError: null,
      sending: false,
      refresh: async () => {
        if (!isTauriEnvironment()) return;
        try {
          await syncHelperContext();
          const view = await nativeTask<HelperView>('helper_snapshot');
          if (JSON.stringify(view) !== JSON.stringify(get().view) || get().syncError)
            set({ view, syncError: null });
        } catch (error) {
          set({ syncError: String(error) });
        }
      },
      send: async () => {
        if (get().sending || get().view.turns.some((turn) => turn.status === 'working')) return;
        const prompt = get().draft.trim();
        if (!prompt) return;
        set({ sending: true, error: null });
        try {
          await syncAgentConfig();
          await syncHelperContext(true);
          const view = await nativeTask<HelperView>('helper_send', { prompt });
          set({ view, draft: '', error: null });
        } catch (error) {
          set({ error: String(error) });
        } finally {
          set({ sending: false });
        }
      },
    }),
    {
      name: 'jackalope-helper-preferences-v1',
      partialize: ({ draft, sharePreferences, shareProjects }) => ({
        draft,
        sharePreferences,
        shareProjects,
      }),
    },
  ),
);

export function helperPreferences() {
  const settings = useSettingsStore.getState();
  const theme = useThemeStore.getState();
  return {
    notifications: settings.notifications,
    mascot_animations: settings.mascotReactions,
    show_theme_picker: settings.showThemePickerInToolbar,
    auto_scroll_logs: settings.autoScrollLogs,
    os_notifications: settings.osNotifications,
    appTheme: theme.appTheme,
    currentTheme: theme.currentTheme,
  };
}

export function helperContext() {
  const { screen, sharePreferences, shareProjects } = useHelperStore.getState();
  const config = useAgentConfigStore.getState();
  const { projects, activeProjectId } = useProjectStore.getState();
  const { runners, runs, lastDiscovered } = useExecutionStore.getState();
  return {
    app: {
      screen,
      defaultAgent: config.defaultMetaAgent,
      execution: 'Local installed agents; worktrees are not a sandbox.',
    },
    agents: runners.map(({ id, name, available, signedIn }) => ({
      id,
      name,
      available,
      signedIn,
      enabled: config.enabledAgents[id] !== false,
      observedAt: lastDiscovered,
    })),
    ...(sharePreferences ? { preferences: helperPreferences() } : {}),
    ...(shareProjects
      ? {
          activeProjectId,
          projects: projects.slice(0, 100).map(({ id, name }) => ({ id, name })),
          tasks: runs
            .filter((run) => run.projectId === activeProjectId)
            .slice(0, 40)
            .map(({ id, status, agent, prompts }) => ({
              id,
              status,
              agent,
              waitingForAnswer: prompts?.some((prompt) => prompt.status === 'pending') ?? false,
            })),
        }
      : {}),
  };
}

export function observeHelper() {
  if (!isTauriEnvironment()) return;
  let contextTimer: ReturnType<typeof setTimeout>;
  const updateContext = () => {
    clearTimeout(contextTimer);
    contextTimer = setTimeout(() => {
      void syncHelperContext().catch((error) =>
        useHelperStore.setState({ syncError: String(error) }),
      );
    }, 100);
  };
  const stops = [
    useHelperStore,
    useProjectStore,
    useExecutionStore,
    useAgentConfigStore,
    useSettingsStore,
    useThemeStore,
  ].map((store) => store.subscribe(updateContext));
  const stop = observeRefresh({
    refresh: () => useHelperStore.getState().refresh(),
    interval: () => {
      const view = useHelperStore.getState().view;
      return view.connected || view.turns.some((turn) => turn.status === 'working') ? 2000 : 10_000;
    },
  });
  return () => {
    stop();
    clearTimeout(contextTimer);
    for (const unsubscribe of stops) unsubscribe();
  };
}
