import { pathToFileURL } from 'node:url';

export const qualityMethod = 'Independent source-family Wilson endpoint difference, z=1.96';
export const qualityMargin = 0.02;

export function wilson(successes, count) {
  if (!count) return [0, 1];
  const z = 1.96,
    p = successes / count,
    d = 1 + (z * z) / count;
  const center = (p + (z * z) / (2 * count)) / d;
  const radius = (z * Math.sqrt((p * (1 - p)) / count + (z * z) / (4 * count * count))) / d;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}

export function studyPlan({ margin = qualityMargin, expectedPassRate = 1, families = 20 } = {}) {
  if (
    !(margin > 0 && margin < 1) ||
    !(expectedPassRate > 0 && expectedPassRate <= 1) ||
    !Number.isSafeInteger(families) ||
    families < 1
  )
    throw new Error(
      'Use a positive margin below 1, pass rate in (0,1], and positive integer family count.',
    );
  const bound = (n, rate) =>
    wilson(Math.floor(n * rate), n)[0] - wilson(Math.floor(n * rate), n)[1];
  let necessaryPerfectFamilies = 1;
  while (bound(necessaryPerfectFamilies, 1) < -margin) necessaryPerfectFamilies++;
  let illustrativeFamilies = necessaryPerfectFamilies;
  while (
    illustrativeFamilies < 1_000_000 &&
    bound(illustrativeFamilies, expectedPassRate) < -margin
  )
    illustrativeFamilies++;
  return {
    version: 1,
    method: qualityMethod,
    margin,
    plannedFamilies: families,
    bestPossibleQualityLowerBound: bound(families, 1),
    necessaryPerfectFamilies,
    canPossiblyPassQualityGate: families >= necessaryPerfectFamilies,
    expectedPassRate,
    illustrativeFamilies: illustrativeFamilies === 1_000_000 ? null : illustrativeFamilies,
    scope:
      'Necessary feasibility check and equal-rate illustration, not a power calculation or publication approval. Repetitions and related seeded defects do not add independent families. Freeze the protocol and power analysis before confirmation; retain failures and complete costs. Screening results cannot be reused as a held-out confirmation set.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const value = (name, fallback) =>
    Number(args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
  console.log(
    JSON.stringify(
      studyPlan({
        families: value('families', 20),
        expectedPassRate: value('pass-rate', 1),
        margin: value('margin', qualityMargin),
      }),
      null,
      2,
    ),
  );
}
