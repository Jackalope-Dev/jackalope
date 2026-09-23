import { create } from 'zustand';
import {
  type AccountStatus,
  type AgentProfile,
  type AgentProfilesView,
  checkAgentProfile,
  listAgentProfiles,
} from '../lib/agent-profiles';

export const CLI_ACCOUNT_ID = '__default';
export const profileId = (id: string) => (id === CLI_ACCOUNT_ID ? null : id);
export function accountProfiles(
  view: AgentProfilesView,
  statuses: Record<string, AccountStatus | undefined>,
): AgentProfile[] {
  return [
    {
      id: CLI_ACCOUNT_ID,
      name: view.defaultName || statuses[CLI_ACCOUNT_ID]?.identity || 'CLI account',
      group: view.defaultGroup,
      tag: view.defaultTag,
    },
    ...view.profiles,
  ];
}
interface Accounts {
  view?: AgentProfilesView;
  statuses: Record<string, AccountStatus | undefined>;
  loading: boolean;
  error: string;
  loadedAt: number;
}
interface State {
  agents: Record<string, Accounts | undefined>;
  load: (agent: string, force?: boolean) => Promise<void>;
  check: (agent: string, id: string) => Promise<void>;
  setStatus: (agent: string, id: string, status: AccountStatus | undefined) => void;
}
const empty = (): Accounts => ({ statuses: {}, loading: false, error: '', loadedAt: 0 });
let checking = 0;
const waiting: (() => void)[] = [];
const versions = new Map<string, number>();
async function queuedCheck(agent: string, id: string) {
  if (checking >= 3) await new Promise<void>((resolve) => waiting.push(resolve));
  else checking++;
  try {
    return await checkAgentProfile(agent, profileId(id));
  } finally {
    const next = waiting.shift();
    if (next) next();
    else checking--;
  }
}
export const useAgentAccountsStore = create<State>((set, get) => ({
  agents: {},
  setStatus: (agent, id, status) => {
    const key = `${agent}:${id}`;
    versions.set(key, (versions.get(key) ?? 0) + 1);
    set((state) => {
      const entry = state.agents[agent] ?? empty();
      return {
        agents: {
          ...state.agents,
          [agent]: { ...entry, statuses: { ...entry.statuses, [id]: status } },
        },
      };
    });
  },
  check: async (agent, id) => {
    get().setStatus(agent, id, undefined);
    const key = `${agent}:${id}`;
    const version = versions.get(key);
    let status: AccountStatus;
    try {
      status = await queuedCheck(agent, id);
    } catch {
      status = {
        state: 'unknown',
        identity: null,
        detail: 'Could not identify this account. Check its sign-in and retry.',
        checkedAt: new Date().toISOString(),
      };
    }
    if (versions.get(key) === version) get().setStatus(agent, id, status);
  },
  load: async (agent, force = false) => {
    const old = get().agents[agent];
    if (old?.loading || (!force && old && Date.now() - old.loadedAt < 60_000)) return;
    set((state) => ({
      agents: { ...state.agents, [agent]: { ...(old ?? empty()), loading: true, error: '' } },
    }));
    let view: AgentProfilesView;
    try {
      view = await listAgentProfiles(agent);
      set((state) => ({
        agents: {
          ...state.agents,
          [agent]: {
            ...(state.agents[agent] ?? empty()),
            view,
            loading: false,
            error: '',
            loadedAt: Date.now(),
          },
        },
      }));
    } catch (cause) {
      set((state) => ({
        agents: {
          ...state.agents,
          [agent]: { ...(state.agents[agent] ?? empty()), loading: false, error: String(cause) },
        },
      }));
      return;
    }
    for (const account of accountProfiles(view, {})) {
      const status = get().agents[agent]?.statuses[account.id];
      if (status && Date.now() - Date.parse(status.checkedAt) < 120_000) continue;
      void get().check(agent, account.id);
    }
  },
}));
