import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopLabel, openableUrl } from '../src/lib/agent-screen.ts';
import { appState } from '../src/lib/composio.ts';
import { rosterOrder, routinePrompt, useBotStore, validateBot } from '../src/stores/botStore.ts';

const draft = (extra = {}) => ({
  name: 'Scout',
  role: 'Keeps dependencies healthy',
  instructions: 'Prefer small updates.',
  agent: 'auto',
  model: null,
  projectId: 'project',
  connectionIds: null,
  ...extra,
});

test('bots require a name and project and bound their instructions', () => {
  assert.equal(validateBot(draft()), '');
  assert.match(validateBot(draft({ name: '  ' })), /name/);
  assert.match(validateBot(draft({ projectId: '' })), /project/);
  assert.match(validateBot(draft({ instructions: 'x'.repeat(6001) })), /6,000/);
});

test('bot store trims, duplicates, pins and forgets removed routines', () => {
  const store = useBotStore.getState();
  const id = store.create(draft({ name: '  Scout  ' }));
  const copy = useBotStore.getState().duplicate(id);
  assert.ok(copy && copy !== id);
  useBotStore.getState().addRoutine(id, 'schedule-1');
  useBotStore.getState().togglePin(copy);
  useBotStore.getState().forgetRoutine('schedule-1');
  const bots = useBotStore.getState().bots;
  assert.equal(bots.find((bot) => bot.id === id).name, 'Scout');
  assert.equal(bots.find((bot) => bot.id === copy).name, 'Scout copy');
  assert.deepEqual(bots.find((bot) => bot.id === id).routineIds, []);
  assert.equal(rosterOrder(bots)[0].id, copy);
  assert.throws(() => useBotStore.getState().update(id, { name: '' }), /name/);
  useBotStore.getState().remove(id);
  assert.equal(
    useBotStore.getState().bots.some((bot) => bot.id === id),
    false,
  );
});

test('routine prompts carry the bot identity and standing instructions', () => {
  const prompt = routinePrompt({ name: 'Scout', instructions: 'Be careful.' }, 'Check updates');
  assert.match(prompt, /You are Scout/);
  assert.ok(prompt.indexOf('Be careful.') < prompt.indexOf('Check updates'));
  assert.doesNotMatch(routinePrompt({ name: 'Scout', instructions: '' }, 'x'), /Standing/);
});

test('connected app state prefers a usable account', () => {
  const account = (status) => ({
    id: status,
    toolkit: 'gmail',
    status,
    alias: null,
    updatedAt: null,
  });
  assert.equal(appState([]), 'available');
  assert.equal(appState([account('FAILED'), account('ACTIVE')]), 'connected');
  assert.equal(appState([account('INITIATED')]), 'pending');
  assert.equal(appState([account('EXPIRED')]), 'failed');
});

test('agent screen only reopens web pages and labels desktop grants', () => {
  assert.equal(openableUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(openableUrl('file:///C:/secret.txt'), null);
  assert.equal(openableUrl('javascript:alert(1)'), null);
  assert.equal(openableUrl(null), null);
  assert.equal(desktopLabel(null).label, 'Not granted');
  assert.equal(
    desktopLabel({ status: 'paused', reason: '', window: 'App', app: 'x' }).tone,
    'warning',
  );
  assert.equal(
    desktopLabel({ status: 'active', reason: '', window: 'App', app: 'x' }).label,
    'In control',
  );
});
