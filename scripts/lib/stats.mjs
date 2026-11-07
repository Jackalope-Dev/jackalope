/** A recorded measurement: a finite, non-negative number. */
export const measured = (value) => Number.isFinite(value) && value >= 0;

/** The total of `values`, or null when any is unmeasured or there are none. */
export const sum = (values) =>
  values.length && values.every(measured) ? values.reduce((a, b) => a + b, 0) : null;

/** Percentage saved going from `before` to `after`, or null when not comparable. */
export const reduction = (before, after) =>
  before > 0 && measured(after) ? 100 * (1 - after / before) : null;

export const quantile = (values, p) =>
  values.length
    ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(p * values.length) - 1)]
    : null;

/**
 * A deterministic generator of numbers in [0, 1) for bootstrap resampling, so a
 * report reproduces exactly from the same data.
 */
export function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
