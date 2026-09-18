import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deduplicateReadHistory } from '../../../scripts/evaluation/history-compaction.mjs';
import {
  historyExperimentEnvironment,
  historyExperimentIdentity,
} from '../../../scripts/evaluation/history-experiment.mjs';
import historyPlugin from '../../../scripts/evaluation/opencode-history-plugin.mjs';

const content = Array.from({ length: 200 }, (_, i) => `export const entry${i} = ${i};`).join('\n');
const read = (id, changes = {}) => ({
  info: { role: 'assistant' },
  parts: [
    {
      type: 'tool',
      tool: 'read',
      callID: id,
      state: {
        status: 'completed',
        input: { filePath: 'src/config.ts' },
        output: content,
        title: 'src/config.ts',
        metadata: {},
        ...changes,
      },
    },
  ],
});

test('duplicate reads retain the first complete result and every call envelope', () => {
  const messages = [
    { info: { role: 'user' }, parts: [{ type: 'text', text: 'Keep requirements.' }] },
    read('first'),
    read('second'),
    read('third'),
  ];
  const before = structuredClone(messages);
  const result = deduplicateReadHistory(messages);
  assert.equal(result.replacements.length, 2);
  assert.equal(result.messages[1].parts[0].state.output, content);
  assert.deepEqual(
    result.messages.map((m) => m.parts[0].callID),
    messages.map((m) => m.parts[0].callID),
  );
  assert.deepEqual(result.messages[0], messages[0]);
  assert.ok(result.replacements.every((row) => row.retainedCallId === 'first'));
  assert.deepEqual(messages, before);
  assert.ok(result.afterBytes < result.beforeBytes);
});

test('changed content, arguments, metadata and titles are independent evidence', () => {
  for (const changes of [
    { output: `${content}\nchanged` },
    { input: { filePath: 'src/other.ts' } },
    { metadata: { sourceRevision: 'new' } },
    { title: 'different location' },
  ]) {
    assert.equal(
      deduplicateReadHistory([read('first'), read('second', changes)]).replacements.length,
      0,
    );
  }
});

test('errors, attachments, truncated and already compacted results remain unchanged', () => {
  for (const changes of [
    { status: 'error' },
    { status: 'running' },
    { attachments: [{ type: 'image' }] },
    { metadata: { truncated: true } },
    { metadata: { isError: true } },
    { metadata: { error: 'failure' } },
    { time: { compacted: 1 } },
    { output: 'short' },
  ]) {
    const messages = [read('first', changes), read('second', changes)];
    assert.equal(deduplicateReadHistory(messages).messages, messages);
  }
});

test('side-effecting tools, unknown tools and user-provided blocks are untouched', () => {
  for (const tool of ['bash', 'write', 'edit', 'mcp_service_read']) {
    const messages = [read('first'), read('second')];
    messages.forEach((m) => {
      m.parts[0].tool = tool;
    });
    assert.equal(deduplicateReadHistory(messages).messages, messages);
  }
  const messages = [read('first'), read('second')];
  messages.forEach((m) => {
    m.info.role = 'user';
  });
  assert.equal(deduplicateReadHistory(messages).messages, messages);
});

test('same call ids and excessive histories are left intact', () => {
  const messages = [read('same'), read('same')];
  assert.equal(deduplicateReadHistory(messages).messages, messages);
  const large = [
    read('one', { output: 'x'.repeat(600_000) }),
    read('two', { output: 'x'.repeat(600_000) }),
  ];
  assert.equal(deduplicateReadHistory(large).messages, large);
  assert.equal(deduplicateReadHistory(large).skipped, 'history-byte-limit');
});

test('the experiment preserves inherited settings and pins implementation hashes', async () => {
  const env = {
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ share: 'disabled', plugin: ['existing-plugin'] }),
  };
  const result = historyExperimentEnvironment('deduplicate', '/private/receipt.jsonl', env);
  const config = JSON.parse(result.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.share, 'disabled');
  assert.equal(config.plugin[0], 'existing-plugin');
  assert.match(config.plugin[1], /^file:.*opencode-history-plugin\.mjs$/);
  assert.deepEqual(JSON.parse(env.OPENCODE_CONFIG_CONTENT).plugin, ['existing-plugin']);
  assert.deepEqual(historyExperimentEnvironment('off', '/unused'), {
    JACKALOPE_HISTORY_COMPACTION_RECEIPT: '',
  });
  assert.throws(() =>
    historyExperimentEnvironment('deduplicate', '/unused', { OPENCODE_CONFIG_CONTENT: '{' }),
  );
  assert.throws(() =>
    historyExperimentEnvironment('deduplicate', '/unused', { OPENCODE_CONFIG_CONTENT: '[]' }),
  );
  const experiments = { after: { 'history-compaction': 'deduplicate' } };
  await assert.rejects(historyExperimentIdentity('claude', experiments));
  const hashes = await historyExperimentIdentity('opencode', experiments);
  assert.equal(Object.keys(hashes).length, 2);
  assert.ok(Object.values(hashes).every((hash) => /^[a-f0-9]{64}$/.test(hash)));
});

test('the plugin records no-op invocations and keeps original history if receipt writing fails', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jackalope-history-plugin-'));
  const names = ['JACKALOPE_HISTORY_COMPACTION', 'JACKALOPE_HISTORY_COMPACTION_RECEIPT'];
  const saved = names.map((name) => process.env[name]);
  try {
    process.env.JACKALOPE_HISTORY_COMPACTION = 'deduplicate';
    const receipt = path.join(directory, 'receipt.jsonl');
    process.env.JACKALOPE_HISTORY_COMPACTION_RECEIPT = receipt;
    const hook = (await historyPlugin())['experimental.chat.messages.transform'];
    const output = { messages: [read('first')] };
    await hook({}, output);
    assert.equal(JSON.parse((await readFile(receipt, 'utf8')).trim()).replacements.length, 0);
    output.messages.push(read('second'));
    const array = output.messages;
    await hook({}, output);
    assert.equal(output.messages, array);
    assert.match(output.messages[1].parts[0].state.output, /exact duplicate/);
    process.env.JACKALOPE_HISTORY_COMPACTION_RECEIPT = path.join(
      directory,
      'missing/receipt.jsonl',
    );
    const original = { messages: [read('first'), read('second')] };
    const before = structuredClone(original);
    await hook({}, original);
    assert.deepEqual(original, before);
  } finally {
    for (const [index, name] of names.entries()) {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    }
    await rm(directory, { recursive: true, force: true });
  }
});
