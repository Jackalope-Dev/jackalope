import { useAgentConfigStore } from '../stores/agentConfigStore.ts';
import { type BuiltinAgentId, getAgentMetadata } from './agent-catalog.ts';
import catalog from './agents.json' with { type: 'json' };

type CatalogEntry = (typeof catalog)[BuiltinAgentId];
type CustomAgents = readonly { id: string; adapter?: string }[];
const entries = Object.entries(catalog) as [BuiltinAgentId, CatalogEntry][];
const idsWhere = (test: (agent: CatalogEntry) => boolean) =>
  entries.filter(([, agent]) => test(agent)).map(([id]) => id);

/** The adapter an agent runs on: a custom agent's adapter, or the agent itself. */
export function agentAdapter(
  agent: string,
  customAgents: CustomAgents = useAgentConfigStore.getState().customAgents,
) {
  return customAgents.find((a) => a.id === agent)?.adapter ?? agent;
}

/** An agent's display name: a custom agent's own name, the catalog name, or its id. */
export function agentName(agent: string) {
  return (
    useAgentConfigStore.getState().customAgents.find((a) => a.id === agent)?.name ??
    getAgentMetadata(agent)?.name ??
    agent
  );
}

/** The brand name alone, as in "Sign in with Claude". */
export function agentShortName(agent: string) {
  return catalog[agent as BuiltinAgentId]?.shortName ?? agentName(agent);
}

/** The catalog entry for the adapter `agent` runs on, if it is a catalog agent. */
export function agentSpec(agent: string, customAgents?: CustomAgents): CatalogEntry | undefined {
  return catalog[agentAdapter(agent, customAgents) as BuiltinAgentId];
}

/** Agents that can route work, answer helper requests and keep separate profiles. */
export const ORCHESTRATING_AGENTS: readonly string[] = idsWhere((agent) => agent.orchestrates);

/** Agents that can sign in to an HTTP connection interactively. */
export const MCP_SIGN_IN_AGENTS: readonly string[] = idsWhere((agent) => agent.mcpSignIn);

/** Agents that keep their own MCP configuration file. */
export const MCP_CONFIG_AGENTS: readonly BuiltinAgentId[] = idsWhere(
  (agent) => agent.mcpConfig !== null,
);

/** Whether an agent on `agent`'s adapter can route work and answer helper requests. */
export function canOrchestrate(agent: string, customAgents?: CustomAgents) {
  return agentSpec(agent, customAgents)?.orchestrates ?? false;
}

/** Whether Jackalope runs tasks on `agent`'s adapter (its own executable, out of development). */
export function runsTasks(agent: string, customAgents?: CustomAgents) {
  const spec = agentSpec(agent, customAgents);
  return !!spec?.binary && !spec.tasksInDevelopment;
}

/** Catalog display names as prose: "A, B or C". */
export function agentNames(ids: readonly string[], last = 'or') {
  const names = ids.map((id) => getAgentMetadata(id)?.name ?? id);
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} ${last} ${names.at(-1)}`
    : names.join('');
}
