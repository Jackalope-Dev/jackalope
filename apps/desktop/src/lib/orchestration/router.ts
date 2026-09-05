import type { Runner } from '../task-runtime';
import { useAgentConfigStore } from '../../stores/agentConfigStore.ts';
import { AGENT_MODELS, getDefaultModelForRunner, getModelById } from './model-catalog.ts';
import type {
  AgentModel,
  AgentRunnerId,
  CandidateScore,
  RoutingDecision,
  RoutingPreference,
  TaskComplexity,
  TaskIntent,
} from './types.ts';

export interface RouteRequest {
  prompt: string;
  projectPath?: string;
  availableRunners: Runner[];
  preference?: RoutingPreference;
  recentFailovers?: { agent: AgentRunnerId; timestamp: number }[];
  forcedAgent?: AgentRunnerId;
  forcedModel?: string;
}

export function detectTaskIntent(prompt: string): TaskIntent {
  const lower = prompt.toLowerCase();

  if (
    lower.includes('refactor') ||
    lower.includes('restructure') ||
    lower.includes('modernize') ||
    lower.includes('split ') ||
    lower.includes('migrate')
  ) {
    return 'refactoring';
  }

  if (
    lower.includes('fix') ||
    lower.includes('bug') ||
    lower.includes('error') ||
    lower.includes('crash') ||
    lower.includes('issue') ||
    lower.includes('failing') ||
    lower.includes('debug')
  ) {
    return 'debugging';
  }

  if (
    lower.includes('test') ||
    lower.includes('coverage') ||
    lower.includes('unit test') ||
    lower.includes('spec')
  ) {
    return 'testing';
  }

  if (
    lower.includes('architect') ||
    lower.includes('design') ||
    lower.includes('engine') ||
    lower.includes('foundation') ||
    lower.includes('system')
  ) {
    return 'architecture';
  }

  if (
    lower.includes('document') ||
    lower.includes('readme') ||
    lower.includes('comment') ||
    lower.includes('jsdoc') ||
    lower.includes('docstring')
  ) {
    return 'documentation';
  }

  if (
    lower.includes('review') ||
    lower.includes('audit') ||
    lower.includes('inspect') ||
    lower.includes('lint')
  ) {
    return 'review';
  }

  if (
    lower.includes('add') ||
    lower.includes('create') ||
    lower.includes('implement') ||
    lower.includes('build') ||
    lower.includes('feature')
  ) {
    return 'feature';
  }

  return 'general';
}

export function estimateComplexity(prompt: string): TaskComplexity {
  const words = prompt.trim().split(/\s+/).length;
  const multiFileKeywords =
    /(across|multiple files|monorepo|components|stores|backend and frontend|full stack|all files)/i;
  const deepKeywords =
    /(algorithm|optimization|concurrency|deadlock|memory leak|performance|security)/i;

  if (words > 120 || multiFileKeywords.test(prompt) || deepKeywords.test(prompt)) {
    return 'complex';
  }
  if (words < 15 && !multiFileKeywords.test(prompt)) {
    return 'trivial';
  }
  return 'standard';
}

function computeCapabilityScore(
  model: AgentModel,
  intent: TaskIntent,
  complexity: TaskComplexity,
): number {
  let score = 0;
  const caps = model.capabilities;

  switch (intent) {
    case 'refactoring':
      score = caps.multiFile * 0.5 + caps.coding * 0.3 + caps.reasoning * 0.2;
      break;
    case 'debugging':
      score = caps.reasoning * 0.5 + caps.coding * 0.4 + caps.speed * 0.1;
      break;
    case 'architecture':
      score = caps.reasoning * 0.6 + caps.multiFile * 0.3 + caps.coding * 0.1;
      break;
    case 'testing':
      score = caps.coding * 0.5 + caps.speed * 0.3 + caps.reasoning * 0.2;
      break;
    case 'documentation':
      score = caps.speed * 0.5 + caps.coding * 0.3 + caps.reasoning * 0.2;
      break;
    case 'review':
      score = caps.reasoning * 0.5 + caps.multiFile * 0.3 + caps.coding * 0.2;
      break;
    case 'feature':
    default:
      score = caps.coding * 0.4 + caps.multiFile * 0.3 + caps.reasoning * 0.3;
      break;
  }

  if (complexity === 'complex') {
    if (model.capabilities.reasoning >= 9.5) score += 1.0;
    if (model.capabilities.multiFile >= 9.5) score += 0.8;
  } else if (complexity === 'trivial') {
    if (model.capabilities.speed >= 9.0) score += 1.2;
  }

  return Math.min(10, Math.max(0, score));
}

function computePreferenceScore(model: AgentModel, pref: RoutingPreference): number {
  switch (pref) {
    case 'quality':
      return model.capabilities.coding * 0.5 + model.capabilities.reasoning * 0.5;
    case 'speed':
      return model.capabilities.speed;
    case 'cost':
      if (model.relativeCost === 'free' || model.relativeCost === 'low') return 9.5;
      if (model.relativeCost === 'medium') return 7.0;
      return 4.0;
    case 'auto':
    default:
      return 8.0;
  }
}

export function determineBestRoute(request: RouteRequest): RoutingDecision {
  const {
    prompt,
    availableRunners,
    preference = 'auto',
    recentFailovers = [],
    forcedAgent,
    forcedModel,
  } = request;

  const intent = detectTaskIntent(prompt);
  const complexity = estimateComplexity(prompt);
  const now = Date.now();

  const runnerMap = new Map<string, Runner>();
  for (const r of availableRunners) {
    runnerMap.set(r.id, r);
  }

  // If forced override is specified
  if (forcedAgent && forcedAgent !== ('auto' as unknown)) {
    const policy = useAgentConfigStore.getState();
    if (!policy.isAgentEnabled(forcedAgent)) throw new Error('This agent is disabled in Agents.');
    if (!runnerMap.get(forcedAgent)?.available)
      throw new Error('This agent is not available. Check its executable in Agents.');
    const options = policy.runnerOptions[forcedAgent];
    const modelId =
      forcedModel ||
      options?.defaultModel ||
      (options?.restrictModels ? options.models.find((m) => m.trim()) : '') ||
      '';
    if (options?.restrictModels && (!modelId || !options.models.includes(modelId)))
      throw new Error('Choose an allowed model in Agents.');
    if (modelId && !policy.isModelAllowed(modelId))
      throw new Error('This model is restricted in Agents.');
    const model = { id: modelId, name: modelId || 'CLI-configured model' };

    return {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      taskTitle: prompt.slice(0, 60),
      detectedIntent: intent,
      complexity,
      chosenAgent: forcedAgent,
      chosenModel: model.id,
      explanation: `Manual override: Dispatched directly to ${model.name} as requested by user.`,
      preference,
      candidates: [],
      isManualOverride: true,
    };
  }

  // Score all candidate models
  const candidateScores: CandidateScore[] = [];
  const agentConfig = useAgentConfigStore.getState();

  const customModels: AgentModel[] = agentConfig.customAgents.flatMap((ca) =>
    ca.models.map((m) => ({
      id: m.id,
      name: m.name,
      runnerId: ca.id as any,
      description: m.description || ca.description,
      contextWindow: 128000,
      capabilities: { coding: 8.5, reasoning: 8.5, speed: 8.5, multiFile: 8.0 },
      relativeCost: 'medium' as const,
    })),
  );

  const allModels = [...AGENT_MODELS, ...customModels];

  for (const model of allModels) {
    // Respect user agent and model restrictions
    if (!agentConfig.isAgentEnabled(model.runnerId)) {
      continue;
    }
    const options = agentConfig.runnerOptions[model.runnerId];
    if (options?.restrictModels && !options.models.includes(model.id)) continue;
    if (!agentConfig.isModelAllowed(model.id)) {
      continue;
    }

    const runner = runnerMap.get(model.runnerId);
    const notes: string[] = [];

    const isAvailable = Boolean(runner?.available);
    const isSignedIn = Boolean(runner?.signedIn);

    if (!isAvailable) {
      notes.push(`${model.runnerId} runner is not installed`);
    } else if (!isSignedIn) {
      notes.push(`${model.runnerId} runner sign-in not verified`);
    }

    // Check recent failovers (cooldown for 5 minutes)
    const recentFail = recentFailovers.find(
      (f) => f.agent === model.runnerId && now - f.timestamp < 300000,
    );
    let capacityScore = 9.0;
    if (recentFail) {
      capacityScore = 3.0;
      notes.push(`Recent failover penalty on ${model.runnerId} within last 5m`);
    }

    const capabilityScore = computeCapabilityScore(model, intent, complexity);
    const preferenceScore = computePreferenceScore(model, preference);
    const affinityScore = runner?.signedIn ? 9.5 : isAvailable ? 7.0 : 1.0;

    // Weight total score
    // Available penalty: if not available, heavily penalize
    const availabilityMultiplier = isAvailable ? (isSignedIn ? 1.0 : 0.85) : 0.1;

    const rawScore =
      capabilityScore * 0.4 + capacityScore * 0.25 + preferenceScore * 0.2 + affinityScore * 0.15;

    const totalScore = Math.round(rawScore * availabilityMultiplier * 10) / 10;

    candidateScores.push({
      agent: model.runnerId,
      model: model.id,
      totalScore,
      capabilityScore: Math.round(capabilityScore * 10) / 10,
      capacityScore: Math.round(capacityScore * 10) / 10,
      affinityScore: Math.round(affinityScore * 10) / 10,
      preferenceScore: Math.round(preferenceScore * 10) / 10,
      available: isAvailable,
      notes,
    });
  }

  // Sort descending by totalScore
  candidateScores.sort((a, b) => b.totalScore - a.totalScore);

  const topCandidate = candidateScores.find((candidate) => candidate.available);
  if (!topCandidate)
    throw new Error('No enabled agent and allowed model is available. Check Agents.');

  const chosenModel =
    getModelById(topCandidate.model) ?? getDefaultModelForRunner(topCandidate.agent);

  // Generate clear user-facing explanation
  let explanation = '';
  if (intent === 'refactoring') {
    explanation = `Selected ${chosenModel.name} for ${complexity} multi-file refactoring (high structural coordination score: ${topCandidate.capabilityScore}/10).`;
  } else if (intent === 'debugging') {
    explanation = `Selected ${chosenModel.name} for deep problem diagnosis & trace reasoning (reasoning score: ${topCandidate.capabilityScore}/10).`;
  } else if (intent === 'testing' || complexity === 'trivial') {
    explanation = `Selected ${chosenModel.name} for high speed and minimal overhead (latency score: ${topCandidate.preferenceScore}/10).`;
  } else {
    explanation = `Selected ${chosenModel.name} as the best overall candidate for this ${intent} task (overall fit: ${topCandidate.totalScore}/10).`;
  }

  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    taskTitle: prompt.slice(0, 60),
    detectedIntent: intent,
    complexity,
    chosenAgent: topCandidate.agent,
    chosenModel: chosenModel.id,
    explanation,
    preference,
    candidates: candidateScores,
  };
}
