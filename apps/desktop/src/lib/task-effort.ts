export const taskEfforts = [
  {
    id: 'quick',
    name: 'Quick',
    description: 'A focused change with targeted checks.',
    instruction:
      'Keep the approach focused. Inspect the affected code, make the smallest complete change, and run the relevant checks.',
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Plan, implement, and check the affected flows.',
    instruction:
      'Plan the work briefly, inspect related call sites and project guidance, implement the complete outcome, and verify the affected flows and edge cases.',
  },
  {
    id: 'thorough',
    name: 'Thorough',
    description: 'Deeper investigation, broader checks, and a review pass.',
    instruction:
      'Investigate dependencies and alternatives before implementation. Work through a plan, cover compatibility and failure paths, run appropriate broader checks, and perform a separate review pass over the final changes.',
  },
] as const;

export type TaskEffort = (typeof taskEfforts)[number]['id'];

export function effortFor(value?: string) {
  return taskEfforts.find((effort) => effort.id === value) ?? taskEfforts[1];
}

export function effortPrompt(value?: string, scoped = true) {
  const effort = effortFor(value);
  const instruction =
    scoped && effort.id === 'balanced'
      ? "Use the task's stated inputs, tools and completion criteria. Inspect applicable project guidance and preserve existing work; broaden repository exploration only when the requested operation depends on it. For code changes, inspect related call sites and affected edge cases. Complete and verify the requested outcome."
      : effort.instruction;
  return `[Task approach: ${effort.name}]\n${instruction}\nPreserve the user's intent and existing work. Report the outcome, checks actually performed, and remaining limitations. Leave changes ready for review; do not claim verification or merge readiness without evidence.`;
}
