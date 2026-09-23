import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('tool fixture negotiates supported versions and answers ping and unsupported requests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jackalope-tool-protocol-'));
  try {
    const data = { report: { items: [{ id: 'exact' }] } };
    await writeFile(join(root, 'data.json'), JSON.stringify(data));
    const messages = [
      { id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { method: 'notifications/initialized' },
      { id: 2, method: 'ping' },
      { id: 3, method: 'resources/list' },
      { id: 4, method: 'tools/list' },
      { id: 5, method: 'tools/call', params: { name: 'fixture_report', arguments: {} } },
    ];
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL('../src-tauri/src/commands/coordination/quality_server.cjs', import.meta.url),
        ),
        join(root, 'data.json'),
        join(root, 'calls.txt'),
        join(root, 'requests.jsonl'),
      ],
      {
        input: `${messages.map((x) => JSON.stringify({ jsonrpc: '2.0', ...x })).join('\n')}\n`,
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const responses = result.stdout.trim().split('\n').map(JSON.parse);
    assert.equal(responses.length, 5);
    assert.equal(responses[0].result.protocolVersion, '2024-11-05');
    assert.deepEqual(responses[1].result, {});
    assert.equal(responses[2].error.code, -32601);
    assert.equal(responses[3].result.tools[0].name, 'fixture_report');
    assert.deepEqual(responses[4].result.structuredContent, data);
    const logged = (await readFile(join(root, 'requests.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.equal(logged.length, 6);
    assert.ok(logged.every((row) => !Object.hasOwn(row, 'arguments')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
