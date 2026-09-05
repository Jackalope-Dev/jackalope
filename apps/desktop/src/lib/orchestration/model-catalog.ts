import type { AgentModel, AgentRunnerId } from './types.ts';

export const AGENT_MODELS: AgentModel[] = [
  // Claude Code Models
  {
    id: 'claude-3-7-sonnet',
    name: 'Claude 3.7 Sonnet',
    runnerId: 'claude',
    description: 'Anthropic hybrid reasoning model. Optimal for complex multi-file refactoring and architecture.',
    contextWindow: 200000,
    capabilities: {
      coding: 9.8,
      reasoning: 9.7,
      speed: 8.2,
      multiFile: 9.9,
    },
    relativeCost: 'high',
    isDefault: true,
  },
  {
    id: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    runnerId: 'claude',
    description: 'Gold standard industry coding assistant. Strong across debugging and features.',
    contextWindow: 200000,
    capabilities: {
      coding: 9.5,
      reasoning: 9.2,
      speed: 8.8,
      multiFile: 9.4,
    },
    relativeCost: 'medium',
  },
  {
    id: 'claude-3-5-haiku',
    name: 'Claude 3.5 Haiku',
    runnerId: 'claude',
    description: 'Ultra-fast, cost-effective model for triage, simple fixes, and test generation.',
    contextWindow: 200000,
    capabilities: {
      coding: 8.4,
      reasoning: 7.9,
      speed: 9.8,
      multiFile: 7.5,
    },
    relativeCost: 'low',
  },

  // OpenAI Codex Models
  {
    id: 'o3-mini',
    name: 'Codex o3-mini',
    runnerId: 'codex',
    description: 'OpenAI high-speed reasoning model. Exceptional for algorithmic code and deep logic.',
    contextWindow: 200000,
    capabilities: {
      coding: 9.6,
      reasoning: 9.8,
      speed: 9.2,
      multiFile: 8.9,
    },
    relativeCost: 'low',
    isDefault: true,
  },
  {
    id: 'o1',
    name: 'Codex o1',
    runnerId: 'codex',
    description: 'Maximum depth reasoning model for complex architectural problems and proofs.',
    contextWindow: 200000,
    capabilities: {
      coding: 9.7,
      reasoning: 9.9,
      speed: 6.5,
      multiFile: 9.1,
    },
    relativeCost: 'high',
  },
  {
    id: 'gpt-4o',
    name: 'Codex GPT-4o',
    runnerId: 'codex',
    description: 'Omni-model for balanced general code generation, docs, and fast edits.',
    contextWindow: 128000,
    capabilities: {
      coding: 9.1,
      reasoning: 8.8,
      speed: 9.0,
      multiFile: 8.6,
    },
    relativeCost: 'medium',
  },

  // Grok Models
  {
    id: 'grok-3',
    name: 'Grok 3',
    runnerId: 'grok',
    description: 'xAI flagship model. Broad reasoning, open problem solving, and comprehensive code edits.',
    contextWindow: 131072,
    capabilities: {
      coding: 9.3,
      reasoning: 9.4,
      speed: 8.5,
      multiFile: 8.7,
    },
    relativeCost: 'medium',
    isDefault: true,
  },
  {
    id: 'grok-beta',
    name: 'Grok Beta',
    runnerId: 'grok',
    description: 'Rapid response coding model for exploratory ideas and quick scripts.',
    contextWindow: 131072,
    capabilities: {
      coding: 8.6,
      reasoning: 8.2,
      speed: 9.4,
      multiFile: 7.9,
    },
    relativeCost: 'low',
  },
];

export const FALLBACK_CHAINS: Record<AgentRunnerId, { agent: AgentRunnerId; model: string }[]> = {
  codex: [
    { agent: 'claude', model: 'claude-3-7-sonnet' },
    { agent: 'grok', model: 'grok-3' },
    { agent: 'claude', model: 'claude-3-5-haiku' },
  ],
  claude: [
    { agent: 'codex', model: 'o3-mini' },
    { agent: 'grok', model: 'grok-3' },
    { agent: 'codex', model: 'gpt-4o' },
  ],
  grok: [
    { agent: 'claude', model: 'claude-3-7-sonnet' },
    { agent: 'codex', model: 'o3-mini' },
    { agent: 'claude', model: 'claude-3-5-sonnet' },
  ],
};

export function getModelsForRunner(runnerId: AgentRunnerId): AgentModel[] {
  return AGENT_MODELS.filter((m) => m.runnerId === runnerId);
}

export function getDefaultModelForRunner(runnerId: AgentRunnerId): AgentModel {
  return (
    AGENT_MODELS.find((m) => m.runnerId === runnerId && m.isDefault) ??
    AGENT_MODELS.find((m) => m.runnerId === runnerId) ??
    AGENT_MODELS[0]
  );
}

export function getModelById(modelId: string): AgentModel | undefined {
  return AGENT_MODELS.find((m) => m.id === modelId);
}
