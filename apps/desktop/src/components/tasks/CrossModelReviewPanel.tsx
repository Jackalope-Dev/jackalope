import { useAgentConfigStore } from '../../stores/agentConfigStore';

/** Maps a custom agent to the adapter it runs on, for account and model-family lookups. */
export function agentAdapter(agent: string) {
  return useAgentConfigStore.getState().customAgents.find((a) => a.id === agent)?.adapter ?? agent;
}
