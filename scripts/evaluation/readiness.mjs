export function providerStopReason(runs) {
  return runs.some((run) => run.quotaFailure)
    ? 'Provider quota stopped the comparison. Remaining trials were not launched; retain the incomplete pair and all reported usage.'
    : null;
}

export function evaluationReadiness(trials, expected) {
  const failures = [];
  for (const request of expected) {
    const matches = trials.filter((trial) =>
      Object.entries(request).every(([key, value]) => trial[key] === value),
    );
    const reasons = [];
    if (matches.length !== 1)
      reasons.push(matches.length ? 'duplicate receipts' : 'missing receipt');
    else {
      const trial = matches[0];
      if (!trial.receipt) reasons.push('missing receipt');
      if (trial.processExit !== 0 || trial.processTimeout || trial.error || trial.launchError)
        reasons.push('execution failed');
      if (
        trial.completed === false ||
        (trial.completed !== true && !['review', 'reviewed'].includes(trial.status))
      )
        reasons.push('incomplete');
      if (trial.budgetStopped !== false) reasons.push('budget stop or unknown budget outcome');
      if (trial.oraclePassed !== true) reasons.push('oracle did not pass');
    }
    if (reasons.length) failures.push({ ...request, reasons });
  }
  return {
    passed: expected.length > 0 && failures.length === 0,
    expected: expected.length,
    failures,
  };
}

export function requireEvaluationPass(trials, expected) {
  const readiness = evaluationReadiness(trials, expected);
  console.log(`Automated evaluation: ${JSON.stringify(readiness)}`);
  if (!readiness.passed) process.exitCode = 1;
}
