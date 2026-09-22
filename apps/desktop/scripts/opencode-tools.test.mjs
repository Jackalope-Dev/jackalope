import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import nativeTools from '../src-tauri/src/commands/tasks/opencode/tools.mjs';

test('native read defaults preserve explicit ranges and require a saved receipt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jackalope-read-'));
  const old = { ...process.env };
  try {
    process.env.JACKALOPE_NATIVE_TOOLS = 'bounded';
    process.env.JACKALOPE_NATIVE_TOOLS_RECEIPT = path.join(root, 'receipts.jsonl');
    const hooks = await nativeTools({ directory: root });
    const definition = {
      description:
        'By default, this tool returns up to 2000 lines. Any line longer than 2000 characters is truncated.',
      parameters: { properties: { limit: {} } },
    };
    await hooks['tool.definition']({ toolID: 'read' }, definition);
    assert.match(definition.parameters.properties.limit.description, /120/);
    assert.match(definition.description, /120 lines/);
    assert.match(definition.description, /2000 characters/);
    const request = { tool: 'read', callID: 'a' };
    const implicit = { args: { filePath: 'a.ts' } };
    await hooks['tool.execute.before'](request, implicit);
    assert.equal(implicit.args.limit, 120);
    for (const args of [
      { filePath: 'a.ts', limit: 2000 },
      { filePath: 'a.ts', offset: 500 },
    ]) {
      const output = { args: { ...args } };
      await hooks['tool.execute.before'](request, output);
      assert.deepEqual(output.args, args);
    }
    delete process.env.JACKALOPE_NATIVE_TOOLS_RECEIPT;
    const unavailable = { args: { filePath: 'a.ts' } };
    await hooks['tool.execute.before'](request, unavailable);
    assert.equal(unavailable.args.limit, undefined);
  } finally {
    process.env = old;
    await rm(root, { recursive: true, force: true });
  }
});

test('native output projection saves exact recovery data and preserves metadata and arguments', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jackalope-output-'));
  const old = { ...process.env };
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      url: request.url,
      token: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks)),
    });
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({ output: 'warning: retained\n90 passed in 0.1s', omitted_lines: 90 }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    process.env.JACKALOPE_NATIVE_TOOLS = 'output';
    process.env.JACKALOPE_NATIVE_TOOLS_RECEIPT = path.join(root, 'receipts.jsonl');
    process.env.JACKALOPE_BRIDGE_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.JACKALOPE_BRIDGE_TOKEN = 'test-only';
    const hooks = await nativeTools();
    const original = `${'test_values.py::test_value PASSED [100%]\n'.repeat(90)}warning: retained\n90 passed in 0.1s\n`;
    const input = { tool: 'bash', callID: 'id', args: { command: 'pytest -v' } };
    for (const metadata of [
      {},
      { exit: 1, truncated: false },
      { exit: 0, truncated: true },
      { exit: null, truncated: false },
    ]) {
      const result = { metadata, output: original };
      await hooks['tool.execute.after'](input, result);
      assert.equal(result.output, original);
    }
    assert.equal(requests.length, 0);
    const result = {
      title: 'pytest -v',
      metadata: { exit: 0, truncated: false, output: 'preview' },
      output: original,
    };
    const metadata = structuredClone(result.metadata);
    await hooks['tool.execute.after'](input, result);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].token, 'Bearer test-only');
    assert.equal(requests[0].body.output, original);
    assert.equal(input.args.command, 'pytest -v');
    assert.deepEqual(result.metadata, metadata);
    const receipt = JSON.parse(
      (await readFile(process.env.JACKALOPE_NATIVE_TOOLS_RECEIPT, 'utf8')).trim(),
    );
    assert.equal(await readFile(receipt.file, 'utf8'), original);
    assert.ok(receipt.afterBytes < receipt.beforeBytes);
    assert.match(result.output, /warning: retained/);
    assert.ok(result.output.includes(receipt.file));
    process.env.JACKALOPE_NATIVE_TOOLS_RECEIPT = path.join(root, 'missing', 'receipts.jsonl');
    const failedSave = { metadata, output: original };
    await hooks['tool.execute.after'](input, failedSave);
    assert.equal(failedSave.output, original);
  } finally {
    process.env = old;
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
