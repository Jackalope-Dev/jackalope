import { readFile, writeFile } from 'node:fs/promises';
import { routingEvidence } from './routing-evidence.mjs';

const args = process.argv.slice(2).filter((a) => a !== '--');
const files = args.filter((a) => !a.startsWith('--'));
const outcome = args.find((a) => a.startsWith('--outcome='))?.slice(10) ?? 'accepted';
const output = args.find((a) => a.startsWith('--output='))?.slice(9);
const reviewFile = args.find((a) => a.startsWith('--reviews='))?.slice(10);
if (!files.length)
  throw new Error(
    'Supply comparison.json files and optionally --reviews=<JSON receipt-to-review map>, --outcome=oraclePassed, --output=<report.json>.',
  );
const comparisons = await Promise.all(
  files.map(async (file) => JSON.parse(await readFile(file, 'utf8'))),
);
if (reviewFile) {
  const reviews = JSON.parse(await readFile(reviewFile, 'utf8'));
  const known = new Set(comparisons.flatMap((c) => c.trials.map((t) => t.receipt)));
  for (const [receipt, review] of Object.entries(reviews)) {
    if (
      !known.has(receipt) ||
      typeof review.accepted !== 'boolean' ||
      typeof review.notes !== 'string' ||
      !review.notes.trim()
    )
      throw new Error(
        'Reviews require a known receipt, boolean accepted outcome and nonempty notes.',
      );
  }
  for (const comparison of comparisons)
    for (const trial of comparison.trials) {
      const review = reviews[trial.receipt];
      if (review) trial.accepted = review.accepted;
    }
}
const report = `${JSON.stringify(routingEvidence(comparisons, outcome), null, 2)}\n`;
if (output) await writeFile(output, report);
else console.log(report);
