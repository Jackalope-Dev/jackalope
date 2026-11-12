import assert from 'node:assert/strict';
import test from 'node:test';
import { apiKeyAdvice } from '../src/lib/api-key-format.ts';

test('API key advice reads provider prefixes without blocking unknown formats', () => {
  assert.equal(apiKeyAdvice('ANTHROPIC_API_KEY', ''), undefined);
  assert.equal(apiKeyAdvice('ANTHROPIC_API_KEY', '  '), undefined);
  assert.equal(apiKeyAdvice('ANTHROPIC_API_KEY', `sk-ant-${'a'.repeat(40)}`).tone, 'ok');
  assert.match(apiKeyAdvice('ANTHROPIC_API_KEY', `sk-${'a'.repeat(40)}`).message, /sk-ant-/);
  assert.equal(apiKeyAdvice('ANTHROPIC_API_KEY', `sk-${'a'.repeat(40)}`).tone, 'info');
  assert.equal(apiKeyAdvice('OPENROUTER_API_KEY', `sk-or-v1-${'a'.repeat(40)}`).tone, 'ok');
  assert.equal(apiKeyAdvice('GEMINI_API_KEY', `AIza${'b'.repeat(35)}`).tone, 'ok');
  assert.equal(apiKeyAdvice('GROQ_API_KEY', `gsk_${'c'.repeat(40)}`).tone, 'ok');
  assert.equal(apiKeyAdvice('MISTRAL_API_KEY', 'x'.repeat(32)).tone, 'ok');
  assert.equal(apiKeyAdvice(undefined, 'short').tone, 'info');
  assert.equal(
    apiKeyAdvice('OPENAI_API_KEY', `sk-${'a'.repeat(20)} sk-${'b'.repeat(20)}`).tone,
    'error',
  );
  assert.equal(apiKeyAdvice('OPENAI_API_KEY', ` sk-${'a'.repeat(30)} `).tone, 'info');
});
