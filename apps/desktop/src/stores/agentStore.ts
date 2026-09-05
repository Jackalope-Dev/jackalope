import { create } from 'zustand';

export interface AgentAccount {
  id: string;
  provider: 'claude-code' | 'aider' | 'openhands' | 'ollama' | 'antigravity';
  accountName: string;
  avatarColor: string;
  authType: 'api-key' | 'oauth' | 'local-socket';
  apiKeyMasked?: string;
  status: 'active' | 'rate-limited' | 'offline';
  tokensUsedToday: number;
  dailyQuota: number;
  activeProcesses: number;
}

export interface AgentProcessLog {
  id: string;
  processId: number;
  taskId: string;
  agentId: string;
  timestamp: string;
  stream: 'stdout' | 'stderr' | 'system';
  message: string;
}

interface AgentStoreState {
  accounts: AgentAccount[];
  activeAccountId: string | null;
  logs: AgentProcessLog[];
  isStreaming: boolean;
  addAccount: (account: Omit<AgentAccount, 'id' | 'tokensUsedToday' | 'activeProcesses'>) => void;
  updateAccount: (id: string, updates: Partial<AgentAccount>) => void;
  removeAccount: (id: string) => void;
  appendLog: (log: Omit<AgentProcessLog, 'id' | 'timestamp'>) => void;
  clearLogs: (taskId?: string) => void;
}

export const useAgentStore = create<AgentStoreState>((set) => ({
  accounts: [
    {
      id: 'acc-1',
      provider: 'claude-code',
      accountName: 'Work / Anthropic Pro',
      avatarColor: '#f97316',
      authType: 'api-key',
      apiKeyMasked: 'sk-ant-api03-••••••••92aF',
      status: 'active',
      tokensUsedToday: 428000,
      dailyQuota: 1000000,
      activeProcesses: 1,
    },
    {
      id: 'acc-2',
      provider: 'antigravity',
      accountName: 'DeepMind Agent Mesh',
      avatarColor: '#10b981',
      authType: 'oauth',
      status: 'active',
      tokensUsedToday: 184000,
      dailyQuota: 2000000,
      activeProcesses: 1,
    },
    {
      id: 'acc-3',
      provider: 'ollama',
      accountName: 'Local RTX 4090 (Qwen 2.5 32B)',
      avatarColor: '#6366f1',
      authType: 'local-socket',
      status: 'active',
      tokensUsedToday: 890000,
      dailyQuota: Infinity,
      activeProcesses: 0,
    },
    {
      id: 'acc-4',
      provider: 'aider',
      accountName: 'Personal / GPT-4o Pairing',
      avatarColor: '#06b6d4',
      authType: 'api-key',
      apiKeyMasked: 'sk-proj-••••••••K91s',
      status: 'active',
      tokensUsedToday: 120000,
      dailyQuota: 500000,
      activeProcesses: 0,
    },
  ],
  activeAccountId: 'acc-1',
  logs: [
    {
      id: 'log-1',
      processId: 4892,
      taskId: 'task-2',
      agentId: 'acc-1',
      timestamp: '17:01:12',
      stream: 'system',
      message: '🚀 Initializing agent container in .worktrees/feat-auto-prompt',
    },
    {
      id: 'log-2',
      processId: 4892,
      taskId: 'task-2',
      agentId: 'acc-1',
      timestamp: '17:01:14',
      stream: 'stdout',
      message: 'Reading repository structure... analyzed 48 files in 12ms',
    },
    {
      id: 'log-3',
      processId: 4892,
      taskId: 'task-2',
      agentId: 'acc-1',
      timestamp: '17:01:18',
      stream: 'stdout',
      message: 'Detected requirement for interactive clarifying question modal',
    },
    {
      id: 'log-4',
      processId: 4892,
      taskId: 'task-2',
      agentId: 'acc-1',
      timestamp: '17:01:25',
      stream: 'stdout',
      message: 'Compiling typescript interfaces for prompt refinement...',
    },
  ],
  isStreaming: true,

  addAccount: (acc) => {
    const id = `acc-${Date.now()}`;
    set((state) => ({
      accounts: [...state.accounts, { ...acc, id, tokensUsedToday: 0, activeProcesses: 0 }],
    }));
  },

  updateAccount: (id, updates) => {
    set((state) => ({
      accounts: state.accounts.map((a) => (a.id === id ? { ...a, ...updates } : a)),
    }));
  },

  removeAccount: (id) => {
    set((state) => ({
      accounts: state.accounts.filter((a) => a.id !== id),
      activeAccountId: state.activeAccountId === id ? null : state.activeAccountId,
    }));
  },

  appendLog: (log) => {
    const id = `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date();
    const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    set((state) => ({
      logs: [...state.logs.slice(-300), { ...log, id, timestamp }],
    }));
  },

  clearLogs: (taskId) => {
    set((state) => ({
      logs: taskId ? state.logs.filter((l) => l.taskId !== taskId) : [],
    }));
  },
}));
