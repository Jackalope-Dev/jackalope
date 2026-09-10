import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const executable = process.argv[2];
if (!executable)
  throw new Error('Pass a local OpenCode executable. This probe downloads no models.');
const root = await mkdtemp(join(tmpdir(), 'jackalope-local-protocol-'));
const workspace = join(root, 'work');
await mkdir(workspace);
const marker = randomUUID();
const model = 'jackalope-qwen3.5-4b';
let requests = 0;
let writes = 0;
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.url, '/v1/chat/completions');
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    assert.equal(input.model, model);
    requests += 1;
    const messages = input.messages;
    const user = messages.findLast((message) => message.role === 'user');
    const target = JSON.stringify(user).includes('LOCAL_RESUME.txt')
      ? 'LOCAL_RESUME.txt'
      : 'LOCAL_CHECK.txt';
    const afterUser = messages.slice(messages.lastIndexOf(user) + 1);
    const shouldWrite =
      input.tools?.some((tool) => tool.function.name === 'write') &&
      !afterUser.some((message) => message.role === 'tool');
    const delta = shouldWrite
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `call_${randomUUID()}`,
              type: 'function',
              function: {
                name: 'write',
                arguments: JSON.stringify({ filePath: join(workspace, target), content: marker }),
              },
            },
          ],
        }
      : { role: 'assistant', content: 'Local protocol fixture completed.' };
    if (shouldWrite) writes += 1;
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = {
      id: `chatcmpl-${randomUUID()}`,
      object: 'chat.completion.chunk',
      created: 1,
      model,
    };
    response.write(
      `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: shouldWrite ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`,
    );
    response.end('data: [DONE]\n\n');
  } catch (error) {
    response.writeHead(500);
    response.end(String(error));
  }
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const configuration = {
  model: 'jackalope-local/qwen3.5:4b',
  small_model: 'jackalope-local/qwen3.5:4b',
  enabled_providers: ['jackalope-local'],
  share: 'disabled',
  permission: {
    '*': 'deny',
    read: 'allow',
    edit: 'allow',
    write: 'allow',
    list: 'allow',
    glob: 'allow',
  },
  provider: {
    'jackalope-local': {
      npm: '@ai-sdk/openai-compatible',
      name: 'Local Ollama',
      options: { baseURL: `http://127.0.0.1:${server.address().port}/v1` },
      models: {
        'qwen3.5:4b': {
          id: model,
          name: 'qwen3.5:4b',
          tool_call: true,
          limit: { context: 65536, output: 8192 },
        },
      },
    },
  },
};
const environment = {
  ...process.env,
  OPENCODE_CONFIG_CONTENT: JSON.stringify(configuration),
  OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
  XDG_CONFIG_HOME: join(root, 'config'),
  XDG_DATA_HOME: join(root, 'data'),
  XDG_CACHE_HOME: join(root, 'cache'),
  XDG_STATE_HOME: join(root, 'state'),
};
delete environment.OPENCODE_CONFIG;
delete environment.OPENCODE_CONFIG_DIR;
async function run(args) {
  const child = spawn(resolve(executable), args, {
    cwd: workspace,
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const timeout = setTimeout(() => child.kill(), 180_000);
  try {
    const code = await new Promise((done, reject) => {
      child.on('error', reject);
      child.on('close', done);
    });
    assert.equal(code, 0, stderr);
    const events = stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line));
    assert(!events.some((event) => event.type === 'error'), JSON.stringify(events));
    assert(
      events.some((event) => event.type === 'tool_use'),
      stdout,
    );
    return events.find((event) => event.sessionID)?.sessionID;
  } finally {
    clearTimeout(timeout);
  }
}
try {
  const args = ['run', '--format', 'json', '--model', 'jackalope-local/qwen3.5:4b'];
  const session = await run([
    ...args,
    `Create LOCAL_CHECK.txt containing exactly ${marker}. Use a file editing tool. Do not run commands.`,
  ]);
  assert(session);
  assert.equal((await readFile(join(workspace, 'LOCAL_CHECK.txt'), 'utf8')).trim(), marker);
  const resumed = await run([
    ...args,
    '--session',
    session,
    'Continue this same session. Read LOCAL_CHECK.txt and copy its exact content into LOCAL_RESUME.txt using a file editing tool. Do not run commands.',
  ]);
  assert.equal(resumed, session);
  assert.equal((await readFile(join(workspace, 'LOCAL_RESUME.txt'), 'utf8')).trim(), marker);
  assert.equal(writes, 2);
  console.log(
    JSON.stringify({
      fixture: true,
      realModelInference: false,
      requests,
      writes,
      resumedSameSession: true,
    }),
  );
} finally {
  await new Promise((done) => server.close(done));
  await rm(root, { recursive: true, force: true });
}
