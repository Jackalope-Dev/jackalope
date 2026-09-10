import type { ContextSelection } from './knowledge';

export interface FeatureStep {
  key: string;
  title: string;
  prompt: string;
  agent: string;
  scopes: string[];
  dependsOn: string[];
  contextSelection?: ContextSelection;
}

export function readFeaturePlan(text: string, agent: string): FeatureStep[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const parsed: unknown = JSON.parse(fenced?.[1] ?? text);
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > 12)
    throw new Error('A feature plan needs 1–12 tasks.');
  const steps: FeatureStep[] = parsed.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`Task ${index + 1} is invalid.`);
    const item = raw as Record<string, unknown>;
    if (
      typeof item.key !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(item.key) ||
      typeof item.title !== 'string' ||
      !item.title.trim() ||
      item.title.length > 160 ||
      typeof item.prompt !== 'string' ||
      !item.prompt.trim() ||
      item.prompt.length > 20000
    )
      throw new Error(`Task ${index + 1} needs a key, title and concrete instructions.`);
    const scopes = item.scopes ?? ['.'];
    const deps = item.dependsOn ?? [];
    const outcomes =
      item.outcomes ?? (item.contextSelection as ContextSelection | undefined)?.outcomes ?? [];
    if (
      !Array.isArray(scopes) ||
      !scopes.length ||
      scopes.length > 30 ||
      scopes.some(
        (s) =>
          typeof s !== 'string' ||
          !s.trim() ||
          s.length > 240 ||
          /^[/\\]|^[A-Za-z]:/.test(s) ||
          s.replaceAll('\\', '/').split('/').includes('..'),
      )
    )
      throw new Error(`Check the file scopes for ${item.title}.`);
    if (
      !Array.isArray(deps) ||
      deps.some((s) => typeof s !== 'string') ||
      !Array.isArray(outcomes) ||
      outcomes.length > 12 ||
      outcomes.some(
        (s) => typeof s !== 'string' || !s.trim() || new TextEncoder().encode(s).length > 500,
      )
    )
      throw new Error(`Check the dependencies and outcomes for ${item.title}.`);
    return {
      key: item.key,
      title: item.title.trim(),
      prompt: item.prompt.trim(),
      agent: typeof item.agent === 'string' && item.agent.trim() ? item.agent.trim() : agent,
      scopes,
      dependsOn: deps,
      contextSelection: { outcomes },
    };
  });
  const known = new Map(steps.map((s) => [s.key, s]));
  if (known.size !== steps.length) throw new Error('Every task needs a unique key.');
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string) => {
    if (visited.has(key)) return;
    if (visiting.has(key)) throw new Error('Dependencies contain a cycle.');
    const step = known.get(key);
    if (!step) throw new Error(`Missing dependency: ${key}`);
    visiting.add(key);
    step.dependsOn.forEach(visit);
    visiting.delete(key);
    visited.add(key);
  };
  for (const step of steps) visit(step.key);
  return steps;
}

export function featurePlanningPrompt(goal: string) {
  return `Plan this feature for human review. Inspect the repository and its instructions. Do not implement changes, commit, install dependencies or launch other tasks. Produce ONLY a JSON array of 1–12 small tasks. Each task needs key (unique letters/numbers/hyphens), title, prompt (self-contained instructions with necessary project decisions), scopes (relative paths, or ["."]), dependsOn (earlier task keys) and outcomes (specific, reviewable requirements). Use actual repository paths for ownership; do not guess conventional folders. Preserve every requirement and constraint from the complete request. Prefer one task for tightly coupled or small changes. Create dependencies only for real data or interface prerequisites, and place independent work in parallel. Keep tests with their implementation where practical. Dependencies consume integrated changes by default, or verified immutable snapshots when the user enables feature staging. Include a final combined-feature verification task when splitting a feature. Include implementation and relevant verification; do not invent repository details. All tasks will use the user's selected assistant. The user edits and approves the plan before any implementation dispatch.\n\nFeature:\n${goal}`;
}
