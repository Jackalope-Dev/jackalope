import { useAgentConfigStore } from '../stores/agentConfigStore.ts';
import { getAgentMetadata } from './agent-catalog.ts';

/** The adapter an agent runs on: a custom agent's adapter, or the agent itself. */
export function agentAdapter(agent: string) {
  return useAgentConfigStore.getState().customAgents.find((a) => a.id === agent)?.adapter ?? agent;
}

/** An agent's display name: a custom agent's own name, the catalog name, or its id. */
export function agentName(agent: string) {
  return (
    useAgentConfigStore.getState().customAgents.find((a) => a.id === agent)?.name ??
    getAgentMetadata(agent)?.name ??
    agent
  );
}
