import assert from 'node:assert/strict';
import test from 'node:test';
import { detectLocalLlms } from '../src/lib/local-detection.ts';

test('detectLocalLlms returns standard ports and service names in fallback mode', async () => {
  const endpoints = await detectLocalLlms();

  assert.equal(endpoints.length, 3);
  const ollama = endpoints.find((e) => e.service === 'Ollama');
  assert.ok(ollama);
  assert.equal(ollama.port, 11434);

  const lmstudio = endpoints.find((e) => e.service === 'LM Studio');
  assert.ok(lmstudio);
  assert.equal(lmstudio.port, 1234);

  const llamacpp = endpoints.find((e) => e.service.includes('llama.cpp'));
  assert.ok(llamacpp);
  assert.equal(llamacpp.port, 8080);
});
