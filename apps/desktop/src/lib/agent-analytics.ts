import type { TaskRun } from './task-runtime.ts';

export interface AgentPerformanceMetric {
  agent: string;
  tasksCount: number;
  avgDurationMs: number;
  totalTokens: number;
  avgTokensPerTask: number;
  estimatedCostUsd: number;
  successRate: number; // 0 to 100
  topSpecialty: string;
}

export interface OrchestrationImpact {
  totalTasks: number;
  rescuedTasksCount: number;
  totalHandoffs: number;
  estimatedTokensSaved: number;
  hoursSaved: number;
  estimatedCostSavedUsd: number;
  fastestAgent: string | null;
  mostCostEffectiveAgent: string | null;
}

export interface AnalyticsSnapshot {
  metrics: AgentPerformanceMetric[];
  impact: OrchestrationImpact;
}

const AGENT_SPECIALTIES: Record<string, string> = {
  codex: 'Systems, Backend & Logic',
  claude: 'Frontend, UI & Types',
  grok: 'Audit, Search & Reasoning',
  opencode: 'Multi-model pair programming',
  antigravity: 'Multi-stage autonomous flows',
  gemini: 'Broad codebase ingestion',
  aider: 'Fast in-place git edits',
  goose: 'Extensible workflow automation',
};

// Estimated pricing per 1k tokens (blended input/output)
const TOKEN_RATES: Record<string, number> = {
  codex: 0.003,
  claude: 0.005,
  grok: 0.004,
  opencode: 0.001,
  antigravity: 0.002,
  gemini: 0.002,
  aider: 0.002,
  goose: 0.001,
};

export function computeAgentAnalytics(runs: TaskRun[]): AnalyticsSnapshot {
  const agentMap = new Map<
    string,
    {
      tasksCount: number;
      successCount: number;
      totalDurationMs: number;
      durationSamples: number;
      totalTokens: number;
      estimatedCostUsd: number;
    }
  >();

  let rescuedTasksCount = 0;
  let totalHandoffs = 0;
  let tokensSavedFromHandoffs = 0;

  for (const run of runs) {
    const agent = run.agent || 'unknown';
    const entry = agentMap.get(agent) || {
      tasksCount: 0,
      successCount: 0,
      totalDurationMs: 0,
      durationSamples: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
    };

    entry.tasksCount += 1;
    if (run.status === 'review' || run.status === 'reviewed') {
      entry.successCount += 1;
    }

    if (run.durationMs && run.durationMs > 0) {
      entry.totalDurationMs += run.durationMs;
      entry.durationSamples += 1;
    }

    if (run.usage?.reported) {
      const tokens = run.usage.input + run.usage.output;
      entry.totalTokens += tokens;
      const rate = TOKEN_RATES[agent] ?? 0.002;
      entry.estimatedCostUsd += (tokens / 1000) * rate;
    }

    // Inspect handoffs
    if (run.routing?.handoffs && run.routing.handoffs.length > 0) {
      const count = run.routing.handoffs.length;
      totalHandoffs += count;
      rescuedTasksCount += 1;
      // Each handoff saved having to restart from scratch: preserve ~25,000 tokens of context
      tokensSavedFromHandoffs += count * 25000;
    }

    agentMap.set(agent, entry);
  }

  const metrics: AgentPerformanceMetric[] = Array.from(agentMap.entries()).map(([agent, stats]) => {
    const avgDurationMs =
      stats.durationSamples > 0 ? Math.round(stats.totalDurationMs / stats.durationSamples) : 0;
    const avgTokensPerTask =
      stats.tasksCount > 0 ? Math.round(stats.totalTokens / stats.tasksCount) : 0;
    const successRate =
      stats.tasksCount > 0 ? Math.round((stats.successCount / stats.tasksCount) * 100) : 100;

    return {
      agent,
      tasksCount: stats.tasksCount,
      avgDurationMs,
      totalTokens: stats.totalTokens,
      avgTokensPerTask,
      estimatedCostUsd: Math.round(stats.estimatedCostUsd * 100) / 100,
      successRate,
      topSpecialty: AGENT_SPECIALTIES[agent] ?? 'General engineering',
    };
  });

  // Determine fastest and most cost effective
  const sortedBySpeed = [...metrics]
    .filter((m) => m.avgDurationMs > 0)
    .sort((a, b) => a.avgDurationMs - b.avgDurationMs);
  const sortedByCost = [...metrics]
    .filter((m) => m.avgTokensPerTask > 0)
    .sort((a, b) => a.avgTokensPerTask - b.avgTokensPerTask);

  const fastestAgent = sortedBySpeed[0]?.agent ?? null;
  const mostCostEffectiveAgent = sortedByCost[0]?.agent ?? null;

  const hoursSaved = Math.round((rescuedTasksCount * 0.75 + runs.length * 0.3) * 10) / 10;
  const estimatedCostSavedUsd =
    Math.round(((tokensSavedFromHandoffs / 1000) * 0.003 + rescuedTasksCount * 4.5) * 100) / 100;

  return {
    metrics,
    impact: {
      totalTasks: runs.length,
      rescuedTasksCount,
      totalHandoffs,
      estimatedTokensSaved: tokensSavedFromHandoffs,
      hoursSaved,
      estimatedCostSavedUsd,
      fastestAgent,
      mostCostEffectiveAgent,
    },
  };
}
