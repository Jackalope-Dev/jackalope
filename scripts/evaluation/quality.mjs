import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemblePrompt } from '../../apps/desktop/src/lib/skills/context-assembler.ts';
import { resolveTaskGuidelines } from '../../apps/desktop/src/lib/skills/task-context.ts';
import { effortPrompt } from '../../apps/desktop/src/lib/task-effort.ts';
import { qualityCases } from './quality-cases.mjs';
import { qualitySummary } from './quality-metrics.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const value = (name, fallback) =>
  args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
const selected = value('--cases', qualityCases.map((c) => c.id).join(',')).split(',');
const repeat = Number(value('--repeat', '3'));
const seconds = Number(value('--seconds', '180'));
const tokens = Number(value('--tokens', '250000'));
const model = value('--model', '');
const agent = value('--agent', 'codex');
const binaries = { before: value('--before', ''), after: value('--after', '') };
if (
  selected.some((id) => !qualityCases.some((c) => c.id === id)) ||
  !Number.isInteger(repeat) ||
  repeat < 1 ||
  repeat > 10 ||
  !Number.isInteger(seconds) ||
  seconds < 30 ||
  seconds > 1800 ||
  !Number.isInteger(tokens) ||
  tokens < 1000 ||
  tokens > 1000000 ||
  !['codex', 'claude'].includes(agent)
)
  throw new Error('Invalid quality evaluation options.');
if (!args.includes('--execute')) {
  console.log(
    JSON.stringify(
      {
        cases: selected,
        variants: Object.keys(binaries),
        repeat,
        seconds,
        tokens,
        agent,
        model: model || 'Required for execution',
        instructions:
          'Pass --execute --model=<model> --before=<saved native test executable> --after=<current native test executable>. Trials use installed accounts; reported token limits are not hard spending caps.',
      },
      null,
      2,
    ),
  );
} else {
  if (!model || Object.values(binaries).some((p) => !path.isAbsolute(p)))
    throw new Error('Pin a model and supply absolute before/after native test executable paths.');
  const baseline = JSON.parse(
    await readFile(new URL('./baselines/f0b95b3-prompts.json', import.meta.url), 'utf8'),
  );
  const output = path.resolve(
    value(
      '--output',
      path.join(root, 'scratch/quality-evaluation', new Date().toISOString().replaceAll(':', '-')),
    ),
  );
  await mkdir(output, { recursive: true });
  const executableHashes = Object.fromEntries(
    await Promise.all(
      Object.entries(binaries).map(async ([name, filename]) => [
        name,
        createHash('sha256')
          .update(await readFile(filename))
          .digest('hex'),
      ]),
    ),
  );
  const cliVersion =
    spawnSync(agent, ['--version'], { encoding: 'utf8', windowsHide: true }).stdout?.trim() ?? null;
  const trials = [];
  for (const id of selected)
    for (let repetition = 1; repetition <= repeat; repetition++) {
      const fixture = qualityCases.find((c) => c.id === id);
      const order = repetition % 2 ? ['before', 'after'] : ['after', 'before'];
      for (const variant of order) {
        const prompt =
          variant === 'before'
            ? baseline.prompts[id]
            : [
                assemblePrompt({
                  rawPrompt: fixture.prompt,
                  selectedSkillIds: resolveTaskGuidelines(fixture.prompt, undefined),
                  executionMode: 'isolated',
                }).assembledPrompt,
                effortPrompt(),
              ].join('\n\n');
        if (!prompt) throw new Error(`Missing frozen baseline for ${id}`);
        const spec = { ...fixture, prompt, variant, agent, model, seconds, tokens };
        const specPath = path.join(output, `${id}-${repetition}-${variant}.json`);
        await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
        console.log(`Quality: ${id}, ${variant}, repetition ${repetition}`);
        const execution = await new Promise((resolve) => {
          const child = spawn(
            binaries[variant],
            [
              'commands::coordination::quality_trial::installed_quality_trial',
              '--ignored',
              '--exact',
              '--nocapture',
            ],
            {
              cwd: root,
              windowsHide: true,
              env: { ...process.env, JACKALOPE_QUALITY_SPEC: specPath, RUST_TEST_THREADS: '1' },
              stdio: ['ignore', 'pipe', 'pipe'],
            },
          );
          let stdout = '',
            stderr = '',
            timedOut = false;
          const timer = setTimeout(
            () => {
              timedOut = true;
              if (process.platform === 'win32' && child.pid)
                spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
                  windowsHide: true,
                  stdio: 'ignore',
                });
              else child.kill('SIGTERM');
            },
            (seconds + 120) * 1000,
          );
          child.stdout.on('data', (chunk) => {
            stdout = (stdout + chunk).slice(-100000);
          });
          child.stderr.on('data', (chunk) => {
            stderr = (stderr + chunk).slice(-16000);
          });
          child.on('error', (error) => {
            clearTimeout(timer);
            resolve({ error: error.message, stdout, stderr });
          });
          child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ code, timedOut, stdout, stderr });
          });
        });
        await writeFile(
          path.join(output, `${id}-${repetition}-${variant}.log`),
          `${execution.stdout}\n${execution.stderr}`,
        );
        const receipt = /Quality receipt: ([^\r\n]+)/.exec(execution.stdout)?.[1];
        let report = null,
          error = execution.error ?? null;
        try {
          if (receipt) report = JSON.parse(await readFile(receipt, 'utf8'));
        } catch (cause) {
          error = String(cause);
        }
        const run = report?.run;
        const usage = run?.usage?.reported ? run.usage : null;
        trials.push({
          case: id,
          variant,
          repetition,
          receipt: receipt ?? null,
          processExit: execution.code ?? null,
          processTimeout: execution.timedOut ?? false,
          error,
          oraclePassed:
            execution.code === 0 &&
            !report?.budgetStopped &&
            run?.status === 'review' &&
            report?.oracle?.success === true,
          status: run?.status ?? null,
          launchError: report?.launchError ?? null,
          elapsedMs: report?.elapsedMs ?? null,
          promptBytes: report?.promptBytes ?? null,
          input: usage?.input ?? null,
          output: usage?.output ?? null,
          cacheRead: usage?.cacheRead ?? null,
          cacheWrite: usage?.cacheWrite ?? null,
          totalTokens: usage ? usage.input + usage.output : null,
          answeredQuestions: run?.prompts?.filter((p) => p.status === 'answered').length ?? 0,
        });
        const summary = qualitySummary(trials, Object.keys(binaries));
        await writeFile(
          path.join(output, 'comparison.json'),
          `${JSON.stringify({ version: 1, baselineRevision: baseline.revision, executableHashes, cliVersion, agent, model, seconds, tokens, trials, summary, limitations: 'Small repeated synthetic native trials, not human acceptance or a direct-GUI comparison. CLI reasoning and provider caching follow the installed configuration. Include failures; missing usage remains unknown.' }, null, 2)}\n`,
        );
        console.log(JSON.stringify(trials.at(-1)));
      }
    }
  console.log(`Quality comparison: ${path.join(output, 'comparison.json')}`);
}
