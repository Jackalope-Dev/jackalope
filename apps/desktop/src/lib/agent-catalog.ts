import catalog from './agents.json' with { type: 'json' };

/**
 * The agent catalog the native side reads too (`src-tauri/src/commands/agents.rs`). Lookups
 * that also cover custom agents take them as an argument; `stores/agentConfigStore.ts` names
 * agents with the saved custom agents.
 */
export type BuiltinAgentId = keyof typeof catalog;
export type CatalogEntry = (typeof catalog)[BuiltinAgentId];
type CustomAgents = readonly { id: string; adapter?: string }[];

export interface AgentMetadata {
  id: BuiltinAgentId;
  name: string;
  vendor: string;
  description: string;
  installCommand: string;
  installUrl: string;
  defaultBinary: string;
  loginCommand: string;
}

const entries = Object.entries(catalog) as [BuiltinAgentId, CatalogEntry][];
const idsWhere = (test: (agent: CatalogEntry) => boolean) =>
  entries.filter(([, agent]) => test(agent)).map(([id]) => id);

/** Every catalog agent in display order. */
export const builtinAgents: readonly AgentMetadata[] = entries.map(([id, agent]) => ({
  id,
  name: agent.name,
  vendor: agent.vendor,
  description: agent.description,
  installCommand: agent.npmPackage ? `npm install -g ${agent.npmPackage}` : '',
  installUrl: agent.installUrl,
  defaultBinary: agent.binary ?? '',
  loginCommand: agent.binary ? [agent.binary, ...agent.loginArgs].join(' ') : '',
}));

export function getAgentMetadata(id: string): AgentMetadata | undefined {
  return builtinAgents.find((agent) => agent.id === id);
}

/** The catalog entry for a catalog agent or adapter id. */
export function catalogEntry(adapter: string): CatalogEntry | undefined {
  return catalog[adapter as BuiltinAgentId];
}

/** The model family an agent runs by default, or null for multi-provider agents. */
export function agentFamily(id: string): string | null {
  return catalogEntry(id)?.family ?? null;
}

/** The adapter an agent runs on: a custom agent's adapter, or the agent itself. */
export function agentAdapter(agent: string, customAgents: CustomAgents) {
  return customAgents.find((a) => a.id === agent)?.adapter ?? agent;
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
export function canOrchestrate(agent: string, customAgents: CustomAgents) {
  return catalogEntry(agentAdapter(agent, customAgents))?.orchestrates ?? false;
}

/** Whether Jackalope runs tasks on `agent`'s adapter (its own executable, out of development). */
export function runsTasks(agent: string, customAgents: CustomAgents) {
  const spec = catalogEntry(agentAdapter(agent, customAgents));
  return !!spec?.binary && !spec.tasksInDevelopment;
}

/** Catalog display names as prose: "A, B or C". */
export function agentNames(ids: readonly string[], last = 'or') {
  const names = ids.map((id) => getAgentMetadata(id)?.name ?? id);
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} ${last} ${names.at(-1)}`
    : names.join('');
}

/** Why `adapter` cannot use a connection over `transport`, or null when it can. */
export function connectionSupport(adapter: string, transport: string, discovery: boolean) {
  const support = catalogEntry(adapter);
  if (!support) return 'Choose a supported agent adapter.';
  if (discovery && support.discovery && transport !== 'sse') return null;
  if (!discovery && (support.direct as string[]).includes(transport)) return null;
  return transport === 'sse'
    ? 'Choose an agent that supports legacy SSE, or use a Streamable HTTP connection with on-demand tools.'
    : 'Enable on-demand tools for this connection to use it with this agent.';
}
