export function jevEvidence(trials) {
  if (!Array.isArray(trials) || !trials.length) throw new Error('Provide nonempty trial records.');
  const seen = new Set();
  const splits = new Map();
  const groups = new Map();
  for (const trial of trials) {
    if (
      !trial.id ||
      !trial.caseId ||
      !trial.configuration ||
      !trial.category ||
      !['local', 'agent', 'jev'].includes(trial.variant) ||
      !['train', 'holdout'].includes(trial.split) ||
      typeof trial.accepted !== 'boolean'
    )
      throw new Error(
        'Every trial needs identity, configuration, variant, split, category and independent acceptance.',
      );
    if (seen.has(trial.id)) throw new Error(`Duplicate trial ${trial.id}.`);
    seen.add(trial.id);
    if (splits.has(trial.caseId) && splits.get(trial.caseId) !== trial.split)
      throw new Error('A case cannot appear in both training and held-out data.');
    splits.set(trial.caseId, trial.split);
    for (const field of ['totalTokens', 'totalCostUsd', 'elapsedMs', 'correctionMinutes']) {
      if (trial[field] != null && (!Number.isFinite(trial[field]) || trial[field] < 0))
        throw new Error(`Invalid ${field}.`);
    }
    if (trial.variant === 'jev' && (!trial.model || !trial.rubricRevision || !trial.inputHash))
      throw new Error('Jev trials need the returned model, rubric revision and input fingerprint.');
    const key = JSON.stringify([trial.variant, trial.configuration, trial.split, trial.category]);
    const group = groups.get(key) ?? [];
    group.push(trial);
    groups.set(key, group);
  }
  const summaries = [...groups.values()].map((values) => {
    const first = values[0];
    const successes = values.filter((v) => v.accepted).length;
    const cases = [...new Set(values.map((v) => v.caseId))].sort();
    const measure = (field) => {
      const known = values.filter((v) => v[field] != null);
      const total = known.reduce((sum, v) => sum + v[field], 0);
      return {
        coverage: known.length,
        total: known.length === values.length ? total : null,
        perAcceptedResult: known.length === values.length && successes ? total / successes : null,
      };
    };
    return {
      variant: first.variant,
      configuration: first.configuration,
      split: first.split,
      category: first.category,
      cases,
      trials: values.length,
      accepted: successes,
      acceptanceRate: successes / values.length,
      minimumSample: cases.length >= 3 && values.length >= 10,
      tokens: measure('totalTokens'),
      costUsd: measure('totalCostUsd'),
      elapsedMs: measure('elapsedMs'),
      correctionMinutes: measure('correctionMinutes'),
      fallbacks: values.filter((v) => v.fallback === true).length,
    };
  });
  return {
    version: 1,
    scope:
      'Offline evidence only. Include all attempts, decision calls, failures and corrections in trial totals. Missing measurements remain unknown. Independent acceptance is required. This report does not change routing policy or prove savings.',
    summaries,
  };
}
