import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BuiltinAgentId } from '../lib/agent-catalog';
import { createPersistStorage } from '../lib/persist-storage.ts';

export type DefaultRunnerId = BuiltinAgentId;
export type NotificationLevel = 'all' | 'failures-only' | 'none';

export interface SettingsState {
  // Experience & appearance
  mascotReactions: boolean;
  showThemePickerInToolbar: boolean;
  showTrialPassesInToolbar: boolean;
  notifications: NotificationLevel;
  osNotifications: boolean;
  interfaceZoom: number;
  terminalFontSize: number;
  terminalShell: 'default' | 'powershell' | 'pwsh' | 'cmd' | 'wsl' | 'bash' | 'zsh';
  preferredEditor: 'vscode' | 'cursor';
  terminalLinks: boolean;
  retainTerminalOutput: boolean;
  shortcuts: Record<string, string>;
  dictationEndpoint: string;
  dictationModel: string;

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

  // Privacy, Telemetry & Marketplace
  useMcpMarketplace: boolean;
  telemetryEnabled: boolean;
  crashReportingEnabled: boolean;

  // Custom runner paths
  customRunnerPaths: Record<string, string>;

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
  mascotReactions: true,
  showThemePickerInToolbar: true,
  showTrialPassesInToolbar: true,
  notifications: 'all' as const,
  osNotifications: true,
  interfaceZoom: 1,
  terminalFontSize: 13,
  terminalShell: 'default',
  preferredEditor: 'vscode',
  terminalLinks: true,
  retainTerminalOutput: false,
  shortcuts: {},
  dictationEndpoint: '',
  dictationModel: 'whisper-1',

  defaultRunner: 'codex' as const,
  concurrencyLimit: 2,
  autoScrollLogs: true,
  maxLogLines: 1000,
  taskTimeoutMinutes: 0, // 0 = no timeout

  branchPrefix: 'jackalope/',
  baseBranch: 'auto',
  worktreeParentDir: '.worktrees',

  useMcpMarketplace: true,
  telemetryEnabled: true, // on by default (opt-out), per docs/BACKEND.md
  crashReportingEnabled: true,

  customRunnerPaths: {
    codex: '',
    claude: '',
    grok: '',
  },
};

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
      storage: createPersistStorage(),
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
