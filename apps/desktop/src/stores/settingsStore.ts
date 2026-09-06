import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ExperienceMode = 'simple' | 'advanced' | 'essential';
export type DefaultRunnerId = 'codex' | 'claude' | 'grok';
export type NotificationLevel = 'all' | 'failures-only' | 'none';

export interface SettingsState {
  // Experience & appearance
  experienceMode: ExperienceMode;
  mascotReactions: boolean;
  soundAlerts: boolean;
  notifications: NotificationLevel;

  // Runners & execution
  defaultRunner: DefaultRunnerId;
  concurrencyLimit: number;
  autoScrollLogs: boolean;
  maxLogLines: number;
  taskTimeoutMinutes: number;

  // Worktree & Git
  branchPrefix: string;
  baseBranch: string;
  worktreeParentDir: string;
  pruneWorktreeOnMerge: boolean;

  // Privacy, Telemetry & Marketplace
  useMcpMarketplace: boolean;
  telemetryEnabled: boolean;
  crashReportingEnabled: boolean;
  debugLogging: boolean;

  // Custom runner paths
  customRunnerPaths: Record<string, string>;

  // Codebase Context Discovery & Memory
  codebaseDiscoveryEnabled: boolean;
  discoveryRefreshCadence: 'manual' | 'startup' | 'hourly' | 'daily';
  maxDiscoveryTokens: number;

  // Actions
  setUseMcpMarketplace: (enabled: boolean) => void;
  updateSettings: (
    partial: Partial<
      Omit<SettingsState, 'updateSettings' | 'resetAll' | 'exportSettings' | 'setUseMcpMarketplace'>
    >,
  ) => void;
  resetAll: () => void;
  exportSettings: () => string;
}

export const DEFAULT_SETTINGS: Omit<
  SettingsState,
  'updateSettings' | 'resetAll' | 'exportSettings' | 'setUseMcpMarketplace'
> = {
  experienceMode: 'simple',
  mascotReactions: true,
  soundAlerts: true,
  notifications: 'all' as const,

  defaultRunner: 'codex' as const,
  concurrencyLimit: 2,
  autoScrollLogs: true,
  maxLogLines: 1000,
  taskTimeoutMinutes: 0, // 0 = no timeout

  branchPrefix: 'jackalope/',
  baseBranch: 'auto',
  worktreeParentDir: '.worktrees',
  pruneWorktreeOnMerge: false,

  useMcpMarketplace: true,
  telemetryEnabled: true, // on by default (opt-out), per docs/BACKEND.md
  crashReportingEnabled: true,
  debugLogging: false,

  customRunnerPaths: {
    codex: '',
    claude: '',
    grok: '',
  },

  codebaseDiscoveryEnabled: true,
  discoveryRefreshCadence: 'startup' as const,
  maxDiscoveryTokens: 500,
};

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

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,

      setUseMcpMarketplace: (enabled: boolean) => set({ useMcpMarketplace: enabled }),

      updateSettings: (partial) => {
        set((state) => ({ ...state, ...partial }));
      },

      resetAll: () => {
        set({ ...DEFAULT_SETTINGS });
      },

      exportSettings: () => {
        const state = get();
        const exportData = Object.fromEntries(
          Object.entries(state).filter(([, value]) => typeof value !== 'function'),
        );
        return JSON.stringify(exportData, null, 2);
      },
    }),
    {
      name: 'jackalope-settings',
      storage: safeStorage,
      merge: (saved, current) => {
        const values = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
        return {
          ...current,
          ...Object.fromEntries(
            Object.keys(DEFAULT_SETTINGS)
              .filter((key) => key in values)
              .map((key) => [key, values[key]]),
          ),
        };
      },
    },
  ),
);
