import { builtinAgents } from './agent-catalog.ts';
import { routeTaskToBestAgent } from './agent-routing.ts';
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

export function multiAgentPlanningPrompt(goal: string, availableRunners: Runner[]): string {
  const installed = availableRunners.filter((r) => r.available);
  const agentList = (installed.length ? installed : availableRunners)
    .map((r) => {
      const meta = builtinAgents.find((a) => a.id === r.id);
      return `- ${r.id} (${r.name}): ${meta?.description || 'General coding assistant'}`;
    })
    .join('\n');

  return `Plan this multi-agent feature for human review. Inspect the repository.
Do not implement changes, commit, install dependencies or launch other tasks.
Produce ONLY a JSON array of 2–6 sequenced tasks.
Each task must be assigned to the most appropriate agent from this list:
${agentList}

JSON Schema:
[
  {
    "key": "unique-task-key",
    "title": "Clear concise task title",
    "prompt": "Self-contained actionable instructions for this specific agent",
    "agent": "one of the agent ids above",
    "scopes": ["relative/path/or/."],
    "dependsOn": ["keys of earlier tasks that must complete first"],
    "rationale": "Why this agent was chosen for this task"
  }
]

Feature:
${goal}`;
}

export function generateHeuristicDecomposition(
  goal: string,
  availableRunners: Runner[],
): DecomposedSubtask[] {
  const lines = goal
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const goalLower = goal.toLowerCase();
  const installed = availableRunners.filter((r) => r.available);
  const runnersToUse = installed.length ? installed : availableRunners;

  // Identify primary domains present in goal
  const hasUi = /ui|react|css|style|frontend|modal|component|page|view|theme|button/.test(
    goalLower,
  );
  const hasBackend = /backend|api|server|database|sql|rust|go|python|endpoint|model|query/.test(
    goalLower,
  );
  const hasTests = /test|verify|check|spec|e2e|coverage|unit/.test(goalLower);

  const subtasks: DecomposedSubtask[] = [];

  // Stage 1: Specification / Core Logic / Types
  const specKey = 'spec-and-contract';
  const specRouting = routeTaskToBestAgent({
    prompt: `Define architecture, interfaces, and types for: ${goal}`,
    scopes: ['src/types', 'docs'],
    effort: 'balanced',
    availableRunners: runnersToUse,
  });

  subtasks.push({
    key: specKey,
    title: 'Define contracts and core models',
    prompt: `Review requirements and establish the data types, API models, and interfaces for: ${lines[0] || goal}. Ensure backward compatibility with existing saved data.`,
    agent: specRouting.agentId,
    agentName: specRouting.agentName,
    scopes: ['.'],
    dependsOn: [],
    rationale: specRouting.rationale,
  });

  // Stage 2: Backend / Engine Implementation (if applicable, or main core)
  const coreKey = 'implementation-core';
  const coreRouting = routeTaskToBestAgent({
    prompt: `Implement core functionality and backend services for: ${goal}`,
    scopes: hasBackend ? ['src-tauri/src', 'src/server'] : ['src/lib'],
    effort: 'balanced',
    availableRunners: runnersToUse,
  });

  subtasks.push({
    key: coreKey,
    title: 'Implement core functionality',
    prompt: `Build the core logic and operations for: ${lines[0] || goal}. Keep the implementation clean and modular, following project conventions.`,
    agent: coreRouting.agentId,
    agentName: coreRouting.agentName,
    scopes: hasBackend ? ['src-tauri/src'] : ['.'],
    dependsOn: [specKey],
    rationale: coreRouting.rationale,
  });

  // Stage 3: UI / Client Integration (if UI mentioned or general)
  if (hasUi || !hasBackend) {
    const uiKey = 'ui-integration';
    const uiRouting = routeTaskToBestAgent({
      prompt: `Build responsive UI components, user flow, and theme styling for: ${goal}`,
      scopes: ['apps/desktop/src/components'],
      effort: 'balanced',
      availableRunners: runnersToUse,
    });

    subtasks.push({
      key: uiKey,
      title: 'Build UI components and interactive views',
      prompt: `Implement the user interface, controls, and accessibility for: ${lines[0] || goal}. Follow the design tokens and verify keyboard and theme support.`,
      agent: uiRouting.agentId,
      agentName: uiRouting.agentName,
      scopes: ['src/components'],
      dependsOn: [coreKey],
      rationale: uiRouting.rationale,
    });
  }

  // Stage 4: Verification and Tests
  const verifyKey = 'verification-and-tests';
  const verifyRouting = routeTaskToBestAgent({
    prompt: `Write comprehensive automated unit tests and verify edge cases for: ${goal}`,
    scopes: ['scripts', 'test', 'tests'],
    effort: 'balanced',
    availableRunners: runnersToUse,
  });

  const lastDep = subtasks[subtasks.length - 1].key;
  subtasks.push({
    key: verifyKey,
    title: hasTests
      ? 'Deep test suite and edge-case verification'
      : 'Automated tests and verification pass',
    prompt: `Write comprehensive test suites covering valid cases, error handling, and regressions for: ${lines[0] || goal}. Run the test suite to ensure green builds.`,
    agent: verifyRouting.agentId,
    agentName: verifyRouting.agentName,
    scopes: ['tests', 'scripts'],
    dependsOn: [lastDep],
    rationale: verifyRouting.rationale,
  });

  return subtasks;
}
