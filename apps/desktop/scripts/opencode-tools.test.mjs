import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import nativeTools from '../src-tauri/src/commands/tasks/opencode/tools.mjs';

test('native output hook falls back unchanged on unavailable or invalid projections', async () => {
  const old = { ...process.env };
  const fetch = globalThis.fetch;
  const root = await mkdtemp(path.join(os.tmpdir(), 'jackalope-output-fallback-'));
  try {
    process.env.JACKALOPE_NATIVE_TOOLS = 'output';
    process.env.JACKALOPE_NATIVE_TOOLS_RECEIPT = path.join(root, 'receipts.jsonl');
    process.env.JACKALOPE_BRIDGE_URL = 'http://127.0.0.1:1';
    process.env.JACKALOPE_BRIDGE_TOKEN = 'test-only';
    const original = `${'test_values.py::test_value PASSED [100%]\n'.repeat(90)}90 passed in 0.1s\n`;
    for (const [response, disable] of [
      [() => new Response('unavailable', { status: 503 }), true],
      [
        () => {
          throw new DOMException('Timed out', 'TimeoutError');
        },
        true,
      ],
      [() => new Response('invalid JSON'), true],
      [() => Response.json(null), false],
      [() => Response.json({ output: 'short', omitted_lines: -1 }), false],
      [() => Response.json({ output: original, omitted_lines: 1 }), false],
    ]) {
      let calls = 0;
      globalThis.fetch = async (_url, options) => {
        calls++;
        assert.equal(options.redirect, 'error');
        assert.ok(options.signal instanceof AbortSignal);
        return response();
      };
      const hooks = await nativeTools();
      for (let n = 0; n < 2; n++) {
        const output = { metadata: { exit: 0, truncated: false }, output: original };
        await hooks['tool.execute.after']({ tool: 'bash' }, output);
        assert.equal(output.output, original);
      }
      assert.equal(calls, disable ? 1 : 2);
    }
    assert.deepEqual(await readdir(root), []);
    globalThis.fetch = async () => {
      assert.fail('Ineligible output must stay local');
    };
    const hooks = await nativeTools();
    for (const [tool, text] of [
      ['read', original],
      ['bash', `${original}<shell_metadata>timed out</shell_metadata>`],
      ['bash', 'ordinary output\n'.repeat(300)],
      ['bash', original.repeat(20)],
      ['bash', '1 passed in 0.1s'],
    ]) {
      const output = { metadata: { exit: 0, truncated: false }, output: text };
      await hooks['tool.execute.after']({ tool }, output);
      assert.equal(output.output, text);
    }
  } finally {
    globalThis.fetch = fetch;
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

test('parallel native output calls share the capture limit and release unused reservations', async () => {
  const old = { ...process.env };
  const fetch = globalThis.fetch;
  try {
    process.env.JACKALOPE_NATIVE_TOOLS = 'output';
    process.env.JACKALOPE_NATIVE_TOOLS_RECEIPT = 'unused-fixture-path';
    process.env.JACKALOPE_BRIDGE_URL = 'http://127.0.0.1:1';
    process.env.JACKALOPE_BRIDGE_TOKEN = 'test-only';
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      await pending;
      return Response.json(null);
    };
    const hooks = await nativeTools();
    const original = `${'x'.repeat(49_950)}\n90 passed in 0.1s`;
    const invoke = () =>
      hooks['tool.execute.after'](
        { tool: 'bash' },
        {
          metadata: { exit: 0, truncated: false },
          output: original,
        },
      );
    const calls = Array.from({ length: 450 }, invoke);
    const limit = Math.floor(20_000_000 / Buffer.byteLength(original));
    assert.equal(requests, limit);
    release();
    await Promise.all(calls);
    await invoke();
    assert.equal(requests, limit + 1);
  } finally {
    globalThis.fetch = fetch;
    process.env = old;
  }
});
