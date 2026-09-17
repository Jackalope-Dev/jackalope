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

export function effortPrompt(value?: string) {
  const effort = effortFor(value);
  return `[Task approach: ${effort.name}]\n${effort.instruction}`;
}
