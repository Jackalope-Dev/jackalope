import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
