import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function reviewResults(
  assignments,
  response,
  { reviewMethod = 'unspecified', timingUse = 'excluded' } = {},
) {
  if (
    !['manual', 'agent-assisted', 'mixed', 'unspecified'].includes(reviewMethod) ||
    !['excluded', 'descriptive'].includes(timingUse)
  )
    throw new Error('Invalid review method or timing use.');
  const includeTime = timingUse === 'descriptive' && reviewMethod === 'manual';
  if (assignments.study !== response.study || !Array.isArray(response.answers))
    throw new Error('Answers belong to a different study.');
  const seen = new Set();
  const rows = response.answers.map((answer) => {
    const assignment = assignments.key.find((item) => item.id === answer.id);
    if (
      !assignment ||
      seen.has(answer.id) ||
      typeof answer.accepted !== 'boolean' ||
      (answer.reviewMinutes != null &&
        (!Number.isFinite(answer.reviewMinutes) || answer.reviewMinutes < 0)) ||
      (includeTime && answer.reviewMinutes == null) ||
      !answer.notes?.trim()
    )
      throw new Error('Invalid or duplicate review answer.');
    seen.add(answer.id);
    return { ...assignment, ...answer };
  });
  const conditions = Object.fromEntries(
    ['diff', 'evidence'].map((condition) => {
      const selected = rows.filter((row) => row.condition === condition);
      const minutes = includeTime
        ? selected.map((row) => row.reviewMinutes).sort((a, b) => a - b)
        : [];
      const middle = Math.floor(minutes.length / 2);
      return [
        condition,
        {
          reviewed: selected.length,
          approved: selected.filter((row) => row.accepted).length,
          totalReviewMinutes: minutes.length ? minutes.reduce((a, b) => a + b, 0) : null,
          medianReviewMinutes: minutes.length
            ? minutes.length % 2
              ? minutes[middle]
              : (minutes[middle - 1] + minutes[middle]) / 2
            : null,
        },
      ];
    }),
  );
  return {
    study: assignments.study,
    reviewMethod,
    timingUse: includeTime ? 'descriptive' : 'excluded',
    complete: rows.length === assignments.key.length,
    planned: assignments.key.length,
    reviewed: rows.length,
    conditions,
    correctionMinutes: null,
    eligibleForCausalClaim: false,
    limitations:
      'One reviewer, distinct tasks and no counterbalanced replication or independent defect-detection check. Differences are descriptive only. Timer measures focused visible page time; interruptions within an unfinished card can be lost on reload. Correction time is not collected. Approval is a reviewer judgment, not proof of correctness.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, answers, output, metadata] = process.argv.slice(2);
  if (!directory || !answers || !output)
    throw new Error(
      'Usage: review-results.mjs study-directory answers.json report.json [metadata.json]',
    );
  const report = reviewResults(
    JSON.parse(await readFile(path.join(directory, 'assignment-key.json'), 'utf8')),
    JSON.parse(await readFile(answers, 'utf8')),
    metadata ? JSON.parse(await readFile(metadata, 'utf8')) : {},
  );
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
