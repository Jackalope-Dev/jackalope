import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startProviderMeter } from '../evaluation/provider-meter.mjs';

const executable = process.argv[2];
const denyBrowser = process.argv.includes('--deny-browser');
if (!executable || !path.isAbsolute(executable))
  throw new Error('Supply an absolute native test executable path; put pinned OpenCode on PATH.');
const directory = await mkdtemp(path.join(os.tmpdir(), 'jackalope-deferred-tools-'));
let calls = 0;
const observations = [];
const meter = await startProviderMeter({
  key: 'local-fixture',
  model: 'deepseek/deepseek-v4-flash',
  fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    const names = (body.tools ?? []).map((tool) => tool.function.name);
    observations.push({
      toolCount: names.length,
      browser: names.filter((name) => name.startsWith('jackalope_browser_')),
    });
    const discover = names.find((name) => name.endsWith('discover_harness_tools'));
    const delta =
      calls++ === 0 && discover
        ? {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                index: 0,
                id: 'discover-fixture',
                type: 'function',
                function: { name: discover, arguments: '{"names":["browser"]}' },
              },
            ],
          }
        : { role: 'assistant', content: 'DISCOVERY_OK' };
    const base = {
      id: 'local-fixture',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'deepseek-v4-flash',
    };
    const chunks = [
      { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
      {
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: 0 },
      },
    ];
    return new Response(
      `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
      { headers: { 'content-type': 'text/event-stream' } },
    );
  },
});
try {
  const config = path.join(directory, 'config');
  await mkdir(path.join(config, 'opencode'), { recursive: true });
  await writeFile(
    path.join(config, 'opencode/opencode.json'),
    JSON.stringify({
      enabled_providers: ['deepseek'],
      model: 'deepseek/deepseek-v4-flash',
      small_model: 'deepseek/deepseek-v4-flash',
      share: 'disabled',
      plugin: [],
      ...(denyBrowser ? { permission: { 'jackalope_browser_*': 'deny' } } : {}),
      provider: { deepseek: { options: { baseURL: meter.url, apiKey: meter.token } } },
    }),
  );
  const spec = path.join(directory, 'spec.json');
  await writeFile(
    spec,
    JSON.stringify({
      id: 'deferred-protocol',
      variant: 'after',
      agent: 'opencode',
      model: 'deepseek/deepseek-v4-flash',
      prompt: 'Discover browser tools, then finish without invoking them or changing files.',
      files: { 'README.md': 'Local protocol fixture.\n' },
      allowedFiles: [],
      oracle: '',
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
    XDG_DATA_HOME: path.join(directory, 'data'),
    XDG_STATE_HOME: path.join(directory, 'state'),
    XDG_CACHE_HOME: path.join(directory, 'cache'),
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
    OPENCODE_DISABLE_AUTOUPDATE: 'true',
    JACKALOPE_QUALITY_SPEC: spec,
    JACKALOPE_TOOL_SURFACE: 'deferred',
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
  await writeFile(path.join(directory, 'native.log'), result.output);
  assert.equal(result.code, 0, `Native protocol fixture failed; inspect ${directory}`);
  const receipt = /Quality receipt: ([^\r\n]+)/.exec(result.output)?.[1];
  const report = JSON.parse(await readFile(receipt, 'utf8'));
  assert.equal(report.run.status, 'review');
  assert.equal(observations[0].browser.length, 0);
  assert(observations.length >= 2);
  if (denyBrowser)
    assert(
      observations.every((request) => request.browser.length === 0),
      'Discovery bypassed client tool permissions',
    );
  else
    assert(
      observations.slice(1).some((request) => request.browser.length === 7),
      'OpenCode did not refresh the deferred tool catalog',
    );
  assert.equal(report.run.efficiency.discoveredHarnessTools.length, 7);
  console.log(
    JSON.stringify({ fixture: true, realInference: false, denyBrowser, directory, observations }),
  );
} finally {
  await meter.close();
}
