import { createHash } from 'node:crypto';

export const hash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex');
export const HISTORY_FILE = 'PROJECT-HISTORY.json';

export function validateLearningCase(task) {
  if (!task.learningHistory) return;
  const cutoff = Date.parse(task.taskAt);
  if (
    !Number.isFinite(cutoff) ||
    !Array.isArray(task.learningHistory) ||
    task.learningHistory.length > 80
  )
    throw new Error('Learning cases require a task date and at most 80 historical attempts.');
  if (hash(JSON.parse(task.files[HISTORY_FILE] ?? 'null')) !== hash(task.learningHistory))
    throw new Error('Every arm must receive the same prior history in PROJECT-HISTORY.json.');
  if (!task.prompt.includes(HISTORY_FILE))
    throw new Error('The identical user prompt must identify the available project history.');
  const ids = new Set();
  for (const attempt of task.learningHistory) {
    if (ids.has(attempt.id)) throw new Error('Duplicate historical attempt.');
    ids.add(attempt.id);
    const dates = [
      attempt.startedAt,
      attempt.endedAt,
      ...(attempt.contract?.requirements ?? []).flatMap((r) =>
        r.receipt ? [r.receipt.recordedAt] : [],
      ),
      ...(attempt.verification ? [attempt.verification.checkedAt] : []),
    ];
    if (dates.some((date) => !Number.isFinite(Date.parse(date)) || Date.parse(date) >= cutoff))
      throw new Error('All historical work, reviews and checks must precede the scored task.');
  }
}

export function validateCandidate(value) {
  if (
    !value ||
    Object.keys(value).sort().join(',') !== 'evidence,guidance,version' ||
    value.version !== 1 ||
    typeof value.guidance !== 'string' ||
    !value.guidance.trim() ||
    Buffer.byteLength(value.guidance) > 1200 ||
    value.guidance.includes('\0') ||
    !Array.isArray(value.evidence) ||
    !value.evidence.length ||
    value.evidence.length > 8 ||
    value.evidence.some((s) => typeof s !== 'string' || !/^[a-z0-9-]+$/.test(s))
  )
    throw new Error(
      'Candidate needs version 1, up to 1,200 bytes of guidance and 1–8 training case IDs.',
    );
  return value;
}

export function validatePartitions(tasks) {
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length)
    throw new Error('Optimization task IDs must be unique.');
  const families = new Map();
  for (const task of tasks) {
    if (!['train', 'validation', 'holdout'].includes(task.split) || !task.source?.family)
      throw new Error('Every learning task needs a split and source family.');
    const previous = families.get(task.source.family);
    if (previous && previous !== task.split)
      throw new Error(`Source family ${task.source.family} crosses optimization partitions.`);
    families.set(task.source.family, task.split);
    validateLearningCase(task);
  }
}

export function trainingEvidence(comparison) {
  if (comparison.trials.some((t) => t.split !== 'train'))
    throw new Error('Only training traces may be supplied to the optimizer.');
  return comparison.trials.map((t) => ({
    case: t.case,
    variant: t.variant,
    repetition: t.repetition,
    outcome: t.quotaFailure
      ? 'quota'
      : t.budgetExceeded
        ? 'budget'
        : t.launchError
          ? 'infrastructure'
          : t.oraclePassed
            ? 'passed'
            : 'failed',
    behavioralPass: t.behavioralOraclePassed,
    scopePass: t.scope?.passed ?? null,
    elapsedMs: t.elapsedMs,
    totalTokens: t.totalTokens,
    toolCalls: t.efficiency?.toolCalls ?? {},
    promptBytes: t.promptBytes,
    diagnostic: t.trainingDiagnostic ?? null,
  }));
}

export function promotionDecision(control, candidate, options = {}) {
  const key = (t) => `${t.case}:${t.repetition}`;
  const base = new Map(control.map((t) => [key(t), t]));
  const matched =
    base.size === control.length &&
    new Set(candidate.map(key)).size === candidate.length &&
    candidate.length > 0 &&
    candidate.length === control.length &&
    candidate.every((t) => base.has(key(t)));
  const blockers = [];
  if (!matched) blockers.push('Incomplete matched validation matrix.');
  if ([...control, ...candidate].some((t) => t.split !== 'validation'))
    blockers.push('Promotion requires separate validation tasks.');
  if (
    [...control, ...candidate].some(
      (t) => t.quotaFailure || t.launchError || t.processTimeout || t.error,
    )
  )
    blockers.push('Infrastructure or incomplete execution prevents candidate selection.');
  if (
    matched &&
    candidate.some((t) => {
      const other = base.get(key(t));
      return (
        !t.model ||
        t.model !== other.model ||
        t.effort !== other.effort ||
        hash(t.experiments) !== hash(other.experiments)
      );
    })
  )
    blockers.push('Validation must use the same explicit model and effort in both arms.');
  if (new Set(candidate.map((t) => t.case)).size < (options.minimumTasks ?? 4))
    blockers.push('Too few distinct validation tasks.');
  if (matched && candidate.some((t) => base.get(key(t)).oraclePassed && !t.oraclePassed))
    blockers.push('A previously passing validation task regressed.');
  const gain =
    candidate.filter((t) => t.oraclePassed).length - control.filter((t) => t.oraclePassed).length;
  const totals = (rows, field) =>
    rows.every((t) => Number.isFinite(t[field]) && t[field] >= 0)
      ? rows.reduce((sum, t) => sum + t[field], 0)
      : null;
  const bounds = ['totalTokens', 'elapsedMs'].map((field) => {
    const a = totals(control, field),
      b = totals(candidate, field);
    return { field, baseline: a, candidate: b, ratio: a > 0 && b !== null ? b / a : null };
  });
  if (gain <= 0) blockers.push('No first-pass success improvement on validation.');
  if (bounds.some((b) => b.ratio === null || b.ratio > (options.maximumOverhead ?? 1.1)))
    blockers.push('Measured token or time overhead exceeds the frozen allowance, or is unknown.');
  return {
    eligibleForHoldout: blockers.length === 0,
    blockers,
    firstPassGain: gain,
    bounds,
    publishable: false,
    limitation:
      'Validation selects a candidate; only a new frozen held-out study can support an outcome claim.',
  };
}
