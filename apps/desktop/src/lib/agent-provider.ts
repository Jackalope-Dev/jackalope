const known = ['claude', 'codex', 'grok', 'kimi', 'opencode', 'antigravity'] as const;

/** Map a runner id or adapter onto the shared agent-character silhouette. */
export function agentProvider(agentId?: string | null, adapter?: string | null): string {
  const source = `${adapter ?? ''} ${agentId ?? ''}`.toLowerCase();
  return known.find((id) => source.includes(id)) ?? adapter ?? agentId ?? 'codex';
}

export function taskAgents(
  run?: {
    agent?: string | null;
    routing?: { handoffs?: { agent: string }[] } | null;
  } | null,
  fallback?: string | null,
): string[] {
  const agents: string[] = [];
  const add = (id?: string | null) => {
    if (!id || id === 'Unassigned' || id === 'auto' || agents.includes(id)) return;
    agents.push(id);
  };
  add(run?.agent);
  for (const handoff of run?.routing?.handoffs ?? []) add(handoff.agent);
  add(fallback);
  return agents;
}
