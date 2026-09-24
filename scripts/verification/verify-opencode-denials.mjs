import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startProviderMeter } from '../evaluation/provider-meter.mjs';
import { gitEnvironment } from '../git-environment.mjs';

const executable = process.argv[2];
if (!executable || !path.isAbsolute(executable))
  throw new Error('Supply an absolute native test executable path; put pinned OpenCode on PATH.');
const directory = await mkdtemp(path.join(os.tmpdir(), 'jackalope-opencode-denials-'));
console.log(`Protocol evidence: ${directory}`);
const opencodeVersion = execFileSync('opencode', ['--version'], {
  encoding: 'utf8',
  windowsHide: true,
}).trim();
const results = [];
for (const scenario of ['continue', 'repeat', 'alternate', 'policy']) {
  const root = path.join(directory, scenario);
  const repo = path.join(root, 'repo');
  const outside = path.join(root, 'outside');
  const sentinel = path.join(outside, 'private.txt');
  const forbidden = `FORBIDDEN_${randomUUID()}`;
  await mkdir(repo, { recursive: true });
  await mkdir(outside);
  await writeFile(sentinel, forbidden);
  await writeFile(path.join(repo, 'README.md'), 'Disposable permission protocol fixture.\n');
  for (const args of [
    ['init', '-b', 'main'],
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'Fixture',
    ],
    [
      'config',
      'jackalope.commitPolicy',
      JSON.stringify({
        attribution: 'user',
        name: 'Fixture',
        email: 'fixture@example.invalid',
        cleanupAfterMerge: false,
        autoCheckpoint: false,
      }),
    ],
  ])
    execFileSync('git', args, {
      cwd: repo,
      stdio: 'pipe',
      windowsHide: true,
      env: gitEnvironment(),
    });
  let calls = 0;
  const observations = [];
  const meter = await startProviderMeter({
    key: 'local-fixture',
    model: 'deepseek/deepseek-v4-flash',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert(!JSON.stringify(body).includes(forbidden), 'Denied file content reached the provider');
      const names = (body.tools ?? []).map((tool) => tool.function.name);
      const main = names.length > 0;
      const turn = main ? calls++ : -1;
      let tool;
      if (turn === 0 || (turn === 1 && scenario === 'repeat'))
        tool = { name: 'read', arguments: { filePath: sentinel } };
      else if (turn === 1 && scenario === 'alternate')
        tool = {
          name: 'bash',
          arguments: {
            command: `cat ${JSON.stringify(sentinel)}`,
            description: 'Read outside fixture',
          },
        };
      else if (turn === 1)
        tool = {
          name: 'write',
          arguments: {
            filePath: path.join(repo, 'completed.txt'),
            content: 'Independent work completed.\n',
          },
        };
      if (tool) assert(names.includes(tool.name), `Missing native ${tool.name} tool`);
      observations.push({ turn, tool: tool?.name ?? null, messages: body.messages });
      const delta = tool
        ? {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                index: 0,
                id: `fixture-${turn}`,
                type: 'function',
                function: { name: tool.name, arguments: JSON.stringify(tool.arguments) },
              },
            ],
          }
        : { role: 'assistant', content: main ? 'DENIAL_WORK_CONTINUED' : 'Permission fixture' };
      const base = {
        id: `local-fixture-${observations.length}`,
        object: 'chat.completion.chunk',
        created: 1,
        model: 'deepseek-v4-flash',
      };
      return new Response(
        `${[
          { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
          {
            ...base,
            choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }],
            usage: { prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: 0 },
          },
        ]
          .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
          .join('')}data: [DONE]\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  try {
    const config = path.join(root, 'config');
    await mkdir(path.join(config, 'opencode'), { recursive: true });
    await writeFile(
      path.join(config, 'opencode/opencode.json'),
      JSON.stringify({
        enabled_providers: ['deepseek'],
        model: 'deepseek/deepseek-v4-flash',
        small_model: 'deepseek/deepseek-v4-flash',
        share: 'disabled',
        plugin: [],
        ...(scenario === 'policy' ? { permission: { external_directory: 'deny' } } : {}),
        provider: { deepseek: { options: { baseURL: meter.url, apiKey: meter.token } } },
      }),
    );
    const spec = path.join(root, 'spec.json');
    await writeFile(
      spec,
      JSON.stringify({
        id: `denial-${scenario}`,
        variant: 'after',
        agent: 'opencode',
        model: 'deepseek/deepseek-v4-flash',
        externalWorkspace: repo,
        permissionPolicy: 'reject',
        prompt:
          'Follow the local protocol fixture. Respect denied actions and continue only independent permitted work.',
        seconds: 30,
        tokens: 100000,
        effort: 'balanced',
      }),
    );
    const env = { ...process.env };
    for (const name of Object.keys(env))
      if (
        /(API_KEY|AUTH_TOKEN|ACCESS_TOKEN)$/.test(name) ||
        name.startsWith('OPENCODE_CONFIG') ||
        name.startsWith('JACKALOPE_')
      )
        delete env[name];
    Object.assign(env, {
      XDG_CONFIG_HOME: config,
      XDG_DATA_HOME: path.join(root, 'data'),
      XDG_STATE_HOME: path.join(root, 'state'),
      XDG_CACHE_HOME: path.join(root, 'cache'),
      OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
      OPENCODE_DISABLE_AUTOUPDATE: 'true',
      JACKALOPE_QUALITY_SPEC: spec,
      JACKALOPE_EXTERNAL_WORKSPACE: repo,
      JACKALOPE_JEV_QUESTIONS: 'off',
    });
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        executable,
        [
          'commands::coordination::quality_trial::installed_quality_trial',
          '--ignored',
          '--exact',
          '--nocapture',
        ],
        { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, output }));
    });
    await writeFile(path.join(root, 'native.log'), result.output);
    await writeFile(path.join(root, 'observations.json'), JSON.stringify(observations, null, 2));
    assert.equal(result.code, 0, `Native fixture failed; inspect ${root}`);
    const receipt = /Quality receipt: ([^\r\n]+)/.exec(result.output)?.[1];
    assert(receipt, `Missing native receipt; inspect ${root}`);
    const report = JSON.parse(await readFile(receipt, 'utf8'));
    await writeFile(path.join(root, 'receipt.json'), JSON.stringify(report, null, 2));
    assert.equal(await readFile(sentinel, 'utf8'), forbidden);
    assert.equal(report.budgetStopped, false);
    const repeated = ['repeat', 'alternate'].includes(scenario);
    assert.equal(report.run.status, repeated ? 'failed' : 'review');
    assert.equal(report.permissionDecisions.length, scenario === 'policy' ? 0 : 1);
    // The rejection can start one final provider request before server teardown.
    if (repeated) assert(calls >= 2 && calls <= 3);
    else assert.equal(calls, 3);
    if (repeated) {
      assert.match(report.run.error, /previously denied/);
      await assert.rejects(readFile(path.join(repo, 'completed.txt')), { code: 'ENOENT' });
    } else {
      const toolResults = observations
        .filter((observation) => observation.turn === 1)
        .flatMap((observation) =>
          observation.messages.filter((message) => message.role === 'tool'),
        );
      assert.match(
        JSON.stringify(toolResults),
        scenario === 'policy' ? /rule which prevents/ : /rejected permission/,
      );
      assert.equal(
        await readFile(path.join(repo, 'completed.txt'), 'utf8'),
        'Independent work completed.\n',
      );
      assert.equal(report.run.result, 'DENIAL_WORK_CONTINUED');
    }
    results.push({
      scenario,
      status: report.run.status,
      calls,
      permissionDecisions: report.permissionDecisions.length,
      deniedFilePreserved: true,
      deniedContentReachedProvider: false,
      receipt,
    });
    console.log(JSON.stringify(results.at(-1)));
  } finally {
    await meter.close();
  }
}
await writeFile(
  path.join(directory, 'summary.json'),
  JSON.stringify(
    {
      fixture: true,
      realInference: false,
      opencodeVersion,
      results,
    },
    null,
    2,
  ),
);
