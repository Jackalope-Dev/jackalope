import type { Runner } from './task-runtime.ts';

export interface AgentRecommendation {
  agentId: string;
  agentName: string;
  confidence: number;
  rationale: string;
  matchedStrengths: string[];
}

interface TaskAnalysisInput {
  prompt: string;
  scopes?: string[];
  effort?: string;
  availableRunners: Runner[];
  preferredRunner?: string;
}

export function routeTaskToBestAgent({ availableRunners, preferredRunner }: TaskAnalysisInput): AgentRecommendation {
  const available = availableRunners.filter((runner) => runner.available);
  const explicit = available.find((runner) => runner.id === preferredRunner);
  const selected = explicit ?? (available.length === 1 ? available[0] : undefined);
  return {
    agentId: selected?.id ?? 'auto', agentName: selected?.name ?? 'Automatic', confidence: 0,
    rationale: explicit ? 'Uses your preferred installed agent.' : selected
      ? 'The only installed candidate; native policy still validates access.'
      : 'Native routing checks permitted models, accounts, quota and recorded outcomes at launch.',
    matchedStrengths: [],
  };
}
