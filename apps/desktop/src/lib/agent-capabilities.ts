import type { BuiltinAgentId } from './agent-catalog';
import capabilities from './agents.json' with { type: 'json' };

export function agentCapabilities(adapter: string) {
  return capabilities[adapter as BuiltinAgentId];
}

export function connectionSupport(adapter: string, transport: string, discovery: boolean) {
  const support = agentCapabilities(adapter);
  if (!support) return 'Choose a supported agent adapter.';
  if (discovery && support.discovery && transport !== 'sse') return null;
  if (!discovery && (support.direct as string[]).includes(transport)) return null;
  return transport === 'sse'
    ? 'Choose an agent that supports legacy SSE, or use a Streamable HTTP connection with on-demand tools.'
    : 'Enable on-demand tools for this connection to use it with this agent.';
}
