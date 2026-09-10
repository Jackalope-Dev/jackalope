export function lowerConfidence(successes, count) {
  if (!count) return 0;
  const z = 1.96;
  const p = successes / count;
  return (
    (p + (z * z) / (2 * count) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * count)) / count)) /
    (1 + (z * z) / count)
  );
}

function score(rows, outcome) {
  const decided = rows.filter((r) => typeof r[outcome] === 'boolean');
  const passed = decided.filter((r) => r[outcome]).length;
  const usageComplete = rows.every((r) => Number.isFinite(r.totalTokens) && r.totalTokens >= 0);
  const tokens =
    rows.length && usageComplete ? rows.reduce((sum, r) => sum + r.totalTokens, 0) : null;
  return {
    trials: rows.length,
    cases: new Set(rows.map((r) => r.case)).size,
    decided: decided.length,
    passed,
    lower95: lowerConfidence(passed, decided.length),
    totalTokens: tokens,
    tokensPerSuccess: passed && tokens !== null ? tokens / passed : null,
  };
}

export function routingEvidence(comparisons, outcome = 'accepted') {
  if (!['accepted', 'oraclePassed'].includes(outcome))
    throw new Error('Choose accepted or oraclePassed outcomes');
  const splits = new Map();
  const receipts = new Set();
  const groups = new Map();
  for (const comparison of comparisons) {
    for (const trial of comparison.trials) {
      if (!['train', 'holdout'].includes(trial.split)) continue;
      const previous = splits.get(trial.case);
      if (previous && previous !== trial.split)
        throw new Error(`Training/holdout overlap: ${trial.case}`);
      splits.set(trial.case, trial.split);
      if (trial.receipt && receipts.has(trial.receipt)) throw new Error('Duplicate trial receipt');
      if (trial.receipt) receipts.add(trial.receipt);
      const key = JSON.stringify([
        trial.category,
        comparison.agent,
        comparison.model,
        trial.effort ?? null,
        trial.variant,
        comparison.cliVersion ?? null,
        comparison.executableHashes?.[trial.variant] ?? null,
        trial.profileFingerprint ?? null,
      ]);
      const group = groups.get(key) ?? {
        category: trial.category,
        agent: comparison.agent,
        model: comparison.model,
        effort: trial.effort ?? null,
        variant: trial.variant,
        cliVersion: comparison.cliVersion ?? null,
        executableHash: comparison.executableHashes?.[trial.variant] ?? null,
        profileFingerprint: trial.profileFingerprint ?? null,
        train: [],
        holdout: [],
      };
      group[trial.split].push(trial);
      groups.set(key, group);
    }
  }
  const candidates = [...groups.values()].map((group) => {
    const train = score(group.train, outcome);
    const holdout = score(group.holdout, outcome);
    return {
      ...group,
      train,
      holdout,
      eligibleFromTraining:
        !!group.cliVersion &&
        !!group.executableHash &&
        !!group.profileFingerprint &&
        train.cases >= 3 &&
        train.decided === train.trials &&
        train.trials >= 10 &&
        train.lower95 >= 0.7 &&
        train.tokensPerSuccess !== null,
    };
  });
  const selections = [...new Set(candidates.map((c) => c.category))].map((category) => {
    const chosen = candidates
      .filter((c) => c.category === category && c.eligibleFromTraining && c.variant !== 'direct')
      .sort((a, b) => a.train.tokensPerSuccess - b.train.tokensPerSuccess)[0];
    return {
      category,
      selected: chosen
        ? {
            agent: chosen.agent,
            model: chosen.model,
            effort: chosen.effort,
            variant: chosen.variant,
          }
        : null,
      heldoutPassed:
        !!chosen &&
        chosen.holdout.cases >= 3 &&
        chosen.holdout.trials >= 10 &&
        chosen.holdout.decided === chosen.holdout.trials &&
        chosen.holdout.lower95 >= 0.7,
    };
  });
  return {
    version: 1,
    outcome,
    candidates,
    selections,
    limitations:
      'Offline evidence only; no live routing policy is changed. Selection uses training results only; held-out results can reject it, never select a replacement. Requires at least three distinct cases and ten decided trials per split; this minimum gate does not establish general superiority. Tokens include unsuccessful trials, not subscription quota or dollars. Direct CLI candidates are comparators only.',
  };
}
