import assert from 'node:assert/strict';
import test from 'node:test';
import {
  experimentEnvironment,
  experimentOptions,
  registry,
} from '../../../scripts/evaluation/experiments.mjs';
import { deepseekUsage, startProviderMeter } from '../../../scripts/evaluation/provider-meter.mjs';
import { studyPlan } from '../../../scripts/evaluation/study-plan.mjs';

test('study planning catches impossible quality gates without treating feasibility as power', () => {
  assert.equal(studyPlan().necessaryPerfectFamilies, 189);
  assert.equal(studyPlan().canPossiblyPassQualityGate, false);
  assert.equal(studyPlan({ families: 188 }).canPossiblyPassQualityGate, false);
  assert.equal(studyPlan({ families: 189 }).canPossiblyPassQualityGate, true);
  assert(studyPlan({ expectedPassRate: 0.95 }).illustrativeFamilies > 189);
  assert.throws(() => studyPlan({ margin: 0 }));
});

test('shared experiment registry pins every native setting and checks dependencies', () => {
  const options = experimentOptions([], ['after']).after;
  const environment = experimentEnvironment(options);
  assert.equal(Object.keys(options).length, Object.keys(registry.fields).length);
  assert.equal(environment.JACKALOPE_WARM_API_HELPERS, 'off');
  assert.equal(environment.JACKALOPE_CONTEXT_PRUNING, 'off');
  assert.throws(() => experimentEnvironment({ ...options, 'result-preview': 'on' }), /requires/);
});

test('provider meter counts auxiliary requests and caches without persisting request or response content', async () => {
  let requests = 0;
  const meter = await startProviderMeter({
    key: 'private-key',
    model: 'deepseek/test',
    fetchImpl: async (_url, init) => {
      requests++;
      assert.equal(init.headers.Authorization, 'Bearer private-key');
      assert.equal(JSON.parse(init.body).messages[0].content, 'private-prompt');
      const content = `data: ${JSON.stringify({ choices: [{ delta: { content: 'private-answer' } }] })}\n\ndata: ${JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 4, prompt_cache_hit_tokens: 6 } })}\n\ndata: [DONE]\n\n`;
      return new Response(content, { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  for (let i = 0; i < 3; i++) {
    const response = await fetch(`${meter.url}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${meter.token}` },
      body: JSON.stringify({
        model: 'test',
        messages: [{ role: 'user', content: 'private-prompt' }],
      }),
    });
    assert((await response.text()).includes('private-answer'));
  }
  const report = await meter.close();
  assert.equal(requests, 3);
  assert.equal(report.complete, true);
  assert.equal(report.requests[0].messageCount, 1);
  assert.equal(report.requests[0].toolCount, 0);
  assert.deepEqual(report.usage, { input: 30, output: 12, cacheRead: 18, cacheWrite: 0 });
  assert(!JSON.stringify(report).includes('private-'));
});

test('provider errors and missing cache usage retain unknown totals', async () => {
  assert.equal(deepseekUsage({ prompt_tokens: 10, completion_tokens: 1 }), null);
  const meter = await startProviderMeter({
    key: 'fixture',
    model: 'deepseek/test',
    fetchImpl: async () => new Response('{}', { status: 429 }),
  });
  const response = await fetch(`${meter.url}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${meter.token}` },
    body: JSON.stringify({ model: 'test' }),
  });
  await response.text();
  const report = await meter.close();
  assert.equal(report.complete, false);
  assert.equal(report.usage, null);
  assert.equal(report.requests[0].status, 429);
});
