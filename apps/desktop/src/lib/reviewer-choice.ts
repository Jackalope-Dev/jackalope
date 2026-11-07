import { agentFamily } from './agent-catalog.ts';
import type { Runner, TaskRun } from './run-types';

const MODEL_FAMILIES: [RegExp, string][] = [
  [/claude|opus|sonnet|haiku|anthropic/, 'anthropic'],
  [/gpt|codex|openai|(^|[^a-z])o[1-9]([^0-9]|$)/, 'openai'],
  [/gemini|gemma|google/, 'google'],
  [/grok|xai/, 'xai'],
  [/kimi|moonshot/, 'moonshot'],
  [/qwen/, 'qwen'],
  [/deepseek/, 'deepseek'],
  [/llama/, 'meta'],
  [/mistral|codestral|devstral/, 'mistral'],
  [/glm|zhipu/, 'zhipu'],
];

/**
 * The model family an agent runs, from its model when that names one, otherwise from the
 * agent's default. Multi-provider agents such as OpenCode have no family without a model.
 */
export function modelFamily(agent: string, model?: string | null): string | null {
  const name = model?.toLowerCase() ?? '';
  return (
    MODEL_FAMILIES.find(([pattern]) => pattern.test(name))?.[1] ?? agentFamily(agent.toLowerCase())
  );
}

/** The agent and model that actually did the work, following automatic routing. */
export function authorOf(run: Pick<TaskRun, 'agent' | 'model' | 'routing'>) {
  const routed = run.agent === 'auto' ? run.routing?.decisions.at(-1) : undefined;
  return routed
    ? { agent: routed.agent, model: routed.model ?? run.model }
    : { agent: run.agent, model: run.model };
}

/**
 * Available reviewers, best first: another model family, then an unknown family, then
 * the author's family on another agent, then the author's own agent.
 */
export function rankReviewers(
  runners: Runner[],
  author: { agent: string; model?: string | null },
  adapterOf: (agent: string) => string = (agent) => agent,
): Runner[] {
  const family = modelFamily(adapterOf(author.agent), author.model);
  const rank = (runner: Runner) => {
    if (runner.id === author.agent) return 3;
    const other = modelFamily(adapterOf(runner.id));
    if (!family || !other) return 1;
    return other === family ? 2 : 0;
  };
  return runners
    .filter((runner) => runner.available)
    .map((runner, index) => ({ runner, index, rank: rank(runner) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ runner }) => runner);
}

/**
 * The reviewer for a plan's combined review: the best-ranked available agent other than
 * the implementer, preferring the planner among equally ranked agents.
 */
export function planReviewer(
  runners: Runner[],
  implementer: { agent: string; model?: string | null },
  planner: string | undefined,
  adapterOf?: (agent: string) => string,
): string | undefined {
  const ordered = [
    ...runners.filter((runner) => runner.id === planner),
    ...runners.filter((runner) => runner.id !== planner),
  ];
  return rankReviewers(ordered, implementer, adapterOf).find(
    (runner) => runner.id !== implementer.agent,
  )?.id;
}
