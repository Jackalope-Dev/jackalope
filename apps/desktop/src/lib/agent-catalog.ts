import catalog from './agents.json' with { type: 'json' };

export type BuiltinAgentId = keyof typeof catalog;

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

/** Every catalog agent in display order, as the native side reads them from agents.json. */
export const builtinAgents: readonly AgentMetadata[] = (
  Object.entries(catalog) as [BuiltinAgentId, (typeof catalog)[BuiltinAgentId]][]
).map(([id, agent]) => ({
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

/** The model family an agent runs by default, or null for multi-provider agents. */
export function agentFamily(id: string): string | null {
  return catalog[id as BuiltinAgentId]?.family ?? null;
}
