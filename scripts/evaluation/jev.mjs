import { readFile, writeFile } from 'node:fs/promises';
import { jevEvidence } from './jev-evidence.mjs';

const [input, output] = process.argv.slice(2);
if (!input || process.argv.length > 4)
  throw new Error('Usage: pnpm evaluate:jev <trials.json> [report.json]');
const report = `${JSON.stringify(jevEvidence(JSON.parse(await readFile(input, 'utf8'))), null, 2)}\n`;
if (output) await writeFile(output, report);
else process.stdout.write(report);
