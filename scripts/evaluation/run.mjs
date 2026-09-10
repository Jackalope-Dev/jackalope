import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const suite = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
const value = (name, fallback) =>
  args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
const cases = value('--case', suite.cases.map((c) => c.id).join(',')).split(',');
const modes = value('--modes', 'single,serial,staged').split(',');
const repeats = Number(value('--repeat', '3'));
const seconds = Number(value('--seconds', '300'));
const tokens = Number(value('--tokens', '1000000'));
if (
  cases.some((id) => !suite.cases.some((c) => c.id === id)) ||
  modes.some((m) => !['single', 'serial', 'staged'].includes(m)) ||
  !Number.isInteger(repeats) ||
  repeats < 1 ||
  repeats > 10 ||
  !Number.isInteger(seconds) ||
  seconds < 30 ||
  seconds > 1800 ||
  !Number.isInteger(tokens) ||
  tokens < 1000 ||
  tokens > 1000000
)
  throw new Error('Invalid evaluation case, mode, repeats or budgets.');
if (!args.includes('--execute')) {
  console.log(
    `Plan: ${cases.join(', ')}; ${modes.join(', ')}; ${repeats} repetitions; ${seconds}s and ${tokens} observed tokens per run. Add --execute to use your installed Codex account. Token reporting is not a hard spending limit.`,
  );
  process.exit(0);
}
const output = path.join(
  root,
  'scratch',
  'execution-evaluation',
  new Date().toISOString().replaceAll(':', '-'),
);
await mkdir(output, { recursive: true });
const receipts = [];
for (const id of cases)
  for (let repetition = 0; repetition < repeats; repetition++) {
    // Rotate order to reduce systematic warm-cache and provider-load bias.
    const order = [
      ...modes.slice(repetition % modes.length),
      ...modes.slice(0, repetition % modes.length),
    ];
    for (const mode of order) {
      console.log(`Evaluating ${id} / ${mode} / repetition ${repetition + 1}`);
      const receipt = await new Promise((resolve, reject) => {
        const child = spawn(
          'cargo',
          [
            'test',
            '--locked',
            '--manifest-path',
            'apps/desktop/src-tauri/Cargo.toml',
            '--lib',
            '--no-default-features',
            'commands::coordination::evaluation_trial::installed_execution_evaluation',
            '--',
            '--ignored',
            '--exact',
            '--nocapture',
          ],
          {
            cwd: root,
            windowsHide: true,
            env: {
              ...process.env,
              JACKALOPE_EVAL_CASE: id,
              JACKALOPE_EVAL_MODE: mode,
              JACKALOPE_EVAL_SECONDS: String(seconds),
              JACKALOPE_EVAL_TOKENS: String(tokens),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let text = '';
        child.stdout.on('data', (chunk) => {
          const part = chunk.toString();
          process.stdout.write(part);
          text = (text + part).slice(-100000);
        });
        child.stderr.on('data', (chunk) => process.stderr.write(chunk));
        child.on('error', reject);
        child.on('exit', (code) => {
          const filename = /Evaluation receipt: ([^\r\n]+)/.exec(text)?.[1];
          if (code !== 0 || !filename)
            reject(new Error(`Evaluation failed (${code}); inspect the retained native profile.`));
          else resolve(filename);
        });
      });
      const report = JSON.parse(await readFile(receipt, 'utf8'));
      receipts.push({
        case: id,
        mode,
        repetition: repetition + 1,
        receipt,
        elapsedMs: report.elapsedMs,
        oraclePassed: report.oracle?.success ?? false,
        budgetStopped: report.budgetStopped,
        reportedTokens: report.runs.every((r) => r.usage.reported)
          ? report.runs.reduce((n, r) => n + r.usage.input + r.usage.output, 0)
          : null,
      });
      await writeFile(
        path.join(output, 'comparison.json'),
        `${JSON.stringify({ version: 1, receipts, acceptance: 'Human review remains unmeasured; oracle success is not acceptance.' }, null, 2)}\n`,
      );
    }
  }
console.log(`Comparison: ${path.join(output, 'comparison.json')}`);
