import { featurePlanningPrompt } from './feature-plan.ts';
import type { Runner } from './task-runtime.ts';

export interface DecomposedSubtask {
  key: string;
  title: string;
  prompt: string;
  agent: string;
  agentName: string;
  scopes: string[];
  dependsOn: string[];
  rationale: string;
}

export function multiAgentPlanningPrompt(goal: string, runners: Runner[]): string {
  const available = runners.filter((r) => r.available);
  return `${featurePlanningPrompt(goal)}\n\nFor each task select agent \"auto\" for native capability/account/quota routing, or one of these installed agents: ${available.map((r) => r.id).join(', ')}. Agent brand names do not establish specialties. Avoid adding workers unless independent work or a separate review justifies the coordination overhead.`;
}

export function generateHeuristicDecomposition(goal: string, _runners: Runner[]): DecomposedSubtask[] {
  return [{
    key: 'complete-request', title: (goal.trim().split('\n')[0] || 'Complete request').slice(0, 140),
    prompt: goal, agent: 'auto', agentName: 'Automatic', scopes: ['.'], dependsOn: [],
    rationale: 'One worker preserves the full request. Ask for a repository-based plan to identify independent work.',
  }];
}
