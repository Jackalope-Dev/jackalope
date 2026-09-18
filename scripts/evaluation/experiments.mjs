import { createHash } from 'node:crypto';

export function experimentOptions(args, variants) {
  const fields = {
    workflow: ['legacy', 'final'],
    'task-approach': ['general', 'scoped'],
    'tool-surface': ['full', 'available'],
    'named-read': ['off', 'on'],
    'result-selection': ['on', 'off'],
    'result-queries': ['off', 'on'],
    'result-preview': ['off', 'on'],
    'initial-tools': ['search', 'small'],
    'repo-map': ['on', 'off'],
    'context-reuse': ['off', 'on'],
    'source-context': ['off', 'on'],
    'batch-read': ['off', 'on'],
    'execution-profile': ['standard', 'lean'],
    'verification-flow': ['agent', 'final'],
    'context-read': ['off', 'on'],
    'context-pruning': ['off', 'on'],
    'history-compaction': ['off', 'deduplicate'],
    'analysis-cache': ['off', 'on'],
    'dispatch-plan': ['off', 'on'],
    'jev-assistance': ['active', 'shadow'],
    'jev-questions': ['off', 'on'],
    'jev-preparation': ['off', 'on'],
    'failure-triage': ['jev', 'local'],
  };
  return Object.fromEntries(
    variants.map((variant) => [
      variant,
      Object.fromEntries(
        Object.entries(fields).map(([name, allowed]) => {
          const value =
            args
              .find((arg) => arg.startsWith(`--${variant}-${name}=`))
              ?.split('=')
              .slice(1)
              .join('=') ?? allowed[0];
          if (!allowed.includes(value)) throw new Error(`Invalid ${variant} ${name}.`);
          return [name, value];
        }),
      ),
    ]),
  );
}

export function experimentEnvironment(options) {
  return {
    JACKALOPE_TOOL_SURFACE: options['tool-surface'],
    JACKALOPE_NAMED_READ: options['named-read'],
    JACKALOPE_RESULT_SELECTION: options['result-selection'],
    JACKALOPE_RESULT_QUERIES: options['result-queries'],
    JACKALOPE_RESULT_PREVIEW: options['result-preview'],
    JACKALOPE_INITIAL_TOOLS: options['initial-tools'],
    JACKALOPE_REPO_MAP: options['repo-map'],
    JACKALOPE_CONTEXT_REUSE: options['context-reuse'],
    JACKALOPE_SOURCE_CONTEXT: options['source-context'],
    JACKALOPE_BATCH_READ: options['batch-read'],
    JACKALOPE_EXECUTION_PROFILE: options['execution-profile'],
    JACKALOPE_VERIFICATION_FLOW: options['verification-flow'],
    JACKALOPE_CONTEXT_READ: options['context-read'],
    JACKALOPE_CONTEXT_PRUNING: options['context-pruning'],
    JACKALOPE_HISTORY_COMPACTION: options['history-compaction'],
    JACKALOPE_ANALYSIS_CACHE: options['analysis-cache'],
    JACKALOPE_DISPATCH_PLAN: options['dispatch-plan'],
    JACKALOPE_JEV_ASSISTANCE: options['jev-assistance'],
    JACKALOPE_JEV_QUESTIONS: options['jev-questions'],
    JACKALOPE_JEV_PREPARATION: options['jev-preparation'],
    JACKALOPE_FAILURE_TRIAGE: options['failure-triage'],
  };
}

export function variantOrder(variants, id, repetition, seed) {
  const initial =
    seed === null ? 0 : createHash('sha256').update(`${seed}:${id}`).digest().readUInt32LE(0);
  const offset = (initial + repetition - 1) % variants.length;
  return [...variants.slice(offset), ...variants.slice(0, offset)];
}
