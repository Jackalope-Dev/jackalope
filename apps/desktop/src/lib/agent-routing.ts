import { builtinAgents } from './agent-catalog.ts';
import type { Runner } from './task-runtime.ts';

export interface AgentRecommendation {
  agentId: string;
  agentName: string;
  confidence: number; // 0 to 1
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

const DOMAIN_PATTERNS = {
  frontend: {
    extensions: ['.tsx', '.jsx', '.css', '.scss', '.html', '.svg', '.vue', '.svelte'],
    keywords: [
      'ui',
      'frontend',
      'react',
      'css',
      'style',
      'styles',
      'button',
      'modal',
      'dialog',
      'component',
      'theme',
      'layout',
      'responsive',
      'tailwind',
      'page',
      'render',
      'animation',
    ],
    bestAgents: ['claude', 'gemini'],
  },
  systems: {
    extensions: ['.rs', '.go', '.c', '.cpp', '.h', '.py', '.java', '.cs'],
    keywords: [
      'backend',
      'database',
      'sql',
      'migration',
      'api',
      'server',
      'performance',
      'concurrency',
      'memory',
      'endpoint',
      'pty',
      'tauri',
      'native',
      'cargo',
      'rust',
      'python',
      'process',
    ],
    bestAgents: ['codex', 'grok'],
  },
  verification: {
    extensions: ['.test.', '.spec.', '__tests__', 'test/'],
    keywords: [
      'test',
      'verify',
      'check',
      'spec',
      'assert',
      'benchmark',
      'coverage',
      'fuzz',
      'e2e',
      'unit',
      'regression',
      'audit',
    ],
    bestAgents: ['grok', 'codex'],
  },
  docs: {
    extensions: ['.md', '.mdx', '.txt', 'docs/'],
    keywords: [
      'doc',
      'docs',
      'document',
      'documentation',
      'readme',
      'guide',
      'changelog',
      'spec',
      'rfc',
      'explain',
    ],
    bestAgents: ['claude', 'gemini', 'antigravity'],
  },
  planning: {
    extensions: [],
    keywords: [
      'plan',
      'architecture',
      'coordinate',
      'orchestrate',
      'multi-step',
      'roadmap',
      'workflow',
      'scaffold',
      'subagents',
    ],
    bestAgents: ['antigravity', 'claude'],
  },
  git: {
    extensions: [],
    keywords: [
      'git',
      'commit',
      'diff',
      'patch',
      'worktree',
      'branch',
      'merge',
      'rebase',
      'quick fix',
      'one-liner',
    ],
    bestAgents: ['aider', 'codex'],
  },
};

export function routeTaskToBestAgent({
  prompt,
  scopes = [],
  effort = 'balanced',
  availableRunners,
  preferredRunner,
}: TaskAnalysisInput): AgentRecommendation {
  const installedRunners = availableRunners.filter((r) => r.available);

  // If no agents are available, fallback to preferred or first
  if (!installedRunners.length) {
    const fallbackId = preferredRunner || availableRunners[0]?.id || 'codex';
    const fallbackName =
      availableRunners.find((r) => r.id === fallbackId)?.name ||
      builtinAgents.find((a) => a.id === fallbackId)?.name ||
      'Codex';
    return {
      agentId: fallbackId,
      agentName: fallbackName,
      confidence: 0.1,
      rationale: 'Default agent selection (no installed agents currently detected).',
      matchedStrengths: [],
    };
  }

  const promptLower = prompt.toLowerCase();
  const scores: Record<string, { score: number; strengths: string[]; reasons: string[] }> = {};

  for (const runner of installedRunners) {
    scores[runner.id] = { score: 0, strengths: [], reasons: [] };
  }

  // Check each domain pattern
  for (const [domainName, domain] of Object.entries(DOMAIN_PATTERNS)) {
    let keywordHits = 0;
    let extensionHits = 0;

    for (const kw of domain.keywords) {
      if (kw.length <= 3) {
        if (new RegExp(`\\b${kw}\\b`, 'i').test(prompt)) {
          keywordHits++;
        }
      } else if (promptLower.includes(kw)) {
        keywordHits++;
      }
    }

    for (const ext of domain.extensions) {
      if (scopes.some((s) => s.toLowerCase().includes(ext)) || promptLower.includes(ext)) {
        extensionHits++;
      }
    }

    if (keywordHits > 0 || extensionHits > 0) {
      const domainStrength =
        (extensionHits > 0 ? 3 : 2) + Math.min(Math.max(0, keywordHits - 1), 4) * 0.5;
      domain.bestAgents.forEach((bestId, idx) => {
        if (scores[bestId]) {
          const rankBonus = Math.max(0, (domain.bestAgents.length - idx) * 0.5);
          scores[bestId].score += domainStrength + rankBonus;
          scores[bestId].strengths.push(domainName);
          if (!scores[bestId].reasons.includes(domainName)) {
            scores[bestId].reasons.push(domainName);
          }
        }
      });
    }
  }

  // Adjust for effort level
  if (effort === 'thorough') {
    // Thorough favors high-reasoning agents like claude, antigravity, grok
    if (scores.claude) scores.claude.score += 2;
    if (scores.antigravity) scores.antigravity.score += 2;
    if (scores.grok) scores.grok.score += 1;
  } else if (effort === 'quick') {
    // Quick favors fast code gen like codex or aider
    if (scores.codex) scores.codex.score += 2;
    if (scores.aider) scores.aider.score += 2;
  }

  // User's project preference adds a boost
  if (preferredRunner && scores[preferredRunner]) {
    scores[preferredRunner].score += 1.5;
  }

  // Signed-in runners get priority over unsigned
  for (const runner of installedRunners) {
    if (runner.signedIn && scores[runner.id]) {
      scores[runner.id].score += 1;
    }
  }

  // Find runner with highest score
  let bestId = installedRunners[0].id;
  let maxScore = -1;

  for (const [id, record] of Object.entries(scores)) {
    if (record.score > maxScore) {
      maxScore = record.score;
      bestId = id;
    }
  }

  const bestRunner = installedRunners.find((r) => r.id === bestId) ?? installedRunners[0];
  const record = scores[bestRunner.id];
  const matchedStrengths = record?.strengths ?? [];

  let rationale = '';
  if (record && record.reasons.length > 0) {
    rationale = `Best suited for ${record.reasons.join(' and ')} tasks based on project scope and intent.`;
  } else if (bestRunner.id === preferredRunner) {
    rationale = 'Matches your project preferred agent.';
  } else if (bestRunner.signedIn) {
    rationale = 'Active signed-in agent ready on your system.';
  } else {
    rationale = 'Installed and available on your system.';
  }

  const confidence = Math.min(0.95, Math.max(0.4, 0.4 + maxScore * 0.08));

  return {
    agentId: bestRunner.id,
    agentName: bestRunner.name,
    confidence: Number(confidence.toFixed(2)),
    rationale,
    matchedStrengths,
  };
}
