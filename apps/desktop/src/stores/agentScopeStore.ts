import { create } from 'zustand';

/**
 * Whether agent pages edit the active project's choices or the defaults for every
 * project. The Agents page and an agent's configuration page share it so a scope
 * chosen on one carries to the other.
 */
interface AgentScopeState {
  scope: 'project' | 'app';
  setScope: (scope: 'project' | 'app') => void;
}

export const useAgentScopeStore = create<AgentScopeState>()((set) => ({
  scope: 'project',
  setScope: (scope) => set({ scope }),
}));
