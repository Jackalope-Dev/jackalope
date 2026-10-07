import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopLabel, openableUrl } from '../src/lib/agent-screen.ts';
import { botRequest, describeWake, hubDirectory, needsYou } from '../src/lib/bot-hub.ts';
import { appState } from '../src/lib/composio.ts';
import {
  migrateBots,
  rosterOrder,
  useBotStore,
  validateBot,
  validateWake,
} from '../src/stores/botStore.ts';

const draft = (extra = {}) => ({
  name: 'Scout',
  role: 'Keeps dependencies healthy',
  instructions: 'Prefer small updates.',
  agent: 'auto',
  model: null,
  projectId: 'project',
  connectionIds: null,
  collaborate: true,
  wakes: [],
  ...extra,
});

const wake = (trigger, extra = {}) => ({
  id: 'wake',
  name: 'Morning',
  prompt: 'Check overnight failures.',
  enabled: true,
  trigger,
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
  const schedule = { kind: 'schedule', expression: '0 9 * * 1-5', timezone: 'UTC' };
  const id = store.create(draft({ name: '  Scout  ', wakes: [wake(schedule)] }));
  const copy = useBotStore.getState().duplicate(id);
  assert.ok(copy && copy !== id);
  const copied = useBotStore.getState().bots.find((bot) => bot.id === copy);
  assert.equal(copied.wakes[0].enabled, false);
  assert.notEqual(copied.wakes[0].id, 'wake');
  useBotStore.setState((state) => ({
    bots: state.bots.map((bot) => (bot.id === id ? { ...bot, routineIds: ['schedule-1'] } : bot)),
  }));
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

test('wake-ups are validated before they reach the native hub', () => {
  const schedule = { kind: 'schedule', expression: '0 9 * * 1-5', timezone: 'UTC' };
  assert.equal(validateWake(wake(schedule), null), '');
  assert.match(validateWake(wake(schedule, { name: ' ' }), null), /Name/);
  assert.match(validateWake(wake(schedule, { prompt: '' }), null), /Describe/);
  assert.match(validateWake(wake({ ...schedule, expression: 'daily' }), null), /when/);
  assert.match(validateWake(wake({ kind: 'repoChange', path: '../outside' }), null), /relative/);
  assert.equal(validateWake(wake({ kind: 'repoChange', path: 'src/api' }), null), '');
  const watch = {
    kind: 'connection',
    connectionId: 'linear',
    tool: 'list_issues',
    arguments: {},
    intervalMinutes: 15,
  };
  assert.equal(validateWake(wake(watch), null), '');
  assert.match(validateWake(wake({ ...watch, intervalMinutes: 1 }), null), /5 minutes/);
  assert.match(validateWake(wake(watch), ['github']), /cannot use/);
  assert.match(validateBot(draft({ wakes: [wake(watch)], connectionIds: ['github'] })), /cannot/);
});

test('older saved bots gain wake-ups and teamwork without losing data', () => {
  const migrated = migrateBots({
    selectedId: 'a',
    bots: [{ id: 'a', name: 'Old', routineIds: ['r'] }],
  });
  assert.equal(migrated.selectedId, 'a');
  assert.deepEqual(migrated.bots[0].wakes, []);
  assert.equal(migrated.bots[0].collaborate, true);
  assert.deepEqual(migrated.bots[0].routineIds, ['r']);
  assert.deepEqual(migrateBots(undefined).bots, []);
});

test('the hub directory carries conversation requests for bots with a project', () => {
  const project = {
    id: 'project',
    name: 'Project',
    path: '/repo',
    gitBranch: 'main',
    preferences: { prepareCommand: 'pnpm install', autoVerify: true, verifyCommand: 'pnpm test' },
  };
  const bot = { ...draft({ agent: 'codex', model: { id: 'gpt', name: 'GPT' } }), id: 'b' };
  const request = botRequest(bot, project, 'id', 'Hi', true, 'profile');
  assert.equal(request.prepareCommand, undefined);
  assert.equal(request.autoVerify, false);
  assert.equal(request.agentProfileId, 'profile');
  assert.equal(request.model, 'gpt');
  assert.equal(botRequest(bot, project, 'id', 'Hi', false).prepareCommand, 'pnpm install');
  const directory = hubDirectory(
    [bot, { ...bot, id: 'orphan', projectId: 'gone' }],
    [project],
    () => undefined,
  );
  assert.deepEqual(
    directory.map((item) => item.id),
    ['b'],
  );
  assert.equal(directory[0].request.projectPath, '/repo');
});

test('only cards with choices and open suggestions wait on the person', () => {
  const card = (extra) => ({
    botId: 'a',
    status: 'open',
    options: [],
    allowText: false,
    ...extra,
  });
  const waiting = needsYou(
    {
      cards: [
        card({ options: [{ label: 'Yes' }] }),
        card({ allowText: true, botId: 'b' }),
        card({}),
        card({ options: [{ label: 'Yes' }], status: 'answered' }),
      ],
      proposals: [
        { fromBotId: 'a', status: 'open' },
        { fromBotId: 'a', status: 'dismissed' },
      ],
    },
    'a',
  );
  assert.equal(waiting.cards.length, 1);
  assert.equal(waiting.count, 2);
  assert.equal(
    describeWake(wake({ kind: 'schedule', expression: '0 9 * * 1-5', timezone: 'UTC' })),
    'Weekdays at 09:00',
  );
  assert.equal(describeWake(wake({ kind: 'repoChange', path: '' })), 'When the project changes');
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

const conversation = (id, extra = {}) => ({
  id,
  title: id,
  persona: { botId: 'scout', name: 'Scout', instructions: '' },
  request: {},
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  paused: false,
  closed: false,
  pinned: false,
  messages: [],
  batches: [],
  draft: { text: '', revision: 0 },
  error: null,
  ...extra,
});

test('bot pages continue the latest open conversation and track unread replies', async () => {
  const {
    batchLimitReached,
    botActivity,
    botConversations,
    continuableConversation,
    isUnread,
    lastReplyAt,
  } = await import('../src/lib/bot-conversations.ts');
  const older = conversation('older', { updatedAt: '2026-10-01T00:00:00Z' });
  const newer = conversation('newer', {
    updatedAt: '2026-10-02T00:00:00Z',
    batches: [{ runId: 'run', messageIds: [], previousRunId: null, error: null, settled: true }],
  });
  const other = conversation('other', {
    persona: { botId: 'else', name: 'Else', instructions: '' },
  });
  const list = botConversations([older, other, newer], 'scout');
  assert.deepEqual(
    list.map((item) => item.id),
    ['newer', 'older'],
  );
  assert.equal(continuableConversation(list)?.id, 'newer');
  assert.equal(continuableConversation([{ ...newer, paused: true }, older]), undefined);
  assert.equal(continuableConversation([{ ...newer, closed: true }]), undefined);
  assert.equal(continuableConversation([]), undefined);

  const runs = [{ id: 'run', status: 'review', endedAt: '2026-10-02T01:00:00Z', prompts: [] }];
  assert.equal(lastReplyAt(newer, runs), '2026-10-02T01:00:00Z');
  assert.equal(isUnread(newer, runs, {}, '2026-10-01T00:00:00Z'), true);
  assert.equal(
    isUnread(newer, runs, { newer: '2026-10-02T02:00:00Z' }, '2026-10-01T00:00:00Z'),
    false,
  );
  // Replies from before read tracking began never count as new.
  assert.equal(isUnread(newer, runs, {}, '2026-10-03T00:00:00Z'), false);
  assert.equal(isUnread(older, runs, {}, '2026-10-01T00:00:00Z'), false);

  assert.equal(botActivity(list, runs), 'idle');
  assert.equal(botActivity(list, [{ ...runs[0], status: 'running', endedAt: null }]), 'working');

  const limited = {
    ...newer,
    paused: true,
    limits: { maxBatches: 1, pauseAtEstimatedUsd: null },
    error:
      'The session reached its batch limit. Review the result and adjust limits before resuming.',
  };
  assert.equal(batchLimitReached(limited), true);
  assert.equal(batchLimitReached({ ...limited, persona: undefined }), false);
  assert.equal(batchLimitReached({ ...limited, error: 'Quota reached' }), false);
});

test('opening a bot conversation selects its bot and reads are remembered', () => {
  const id = useBotStore.getState().create(draft({ name: 'Reader' }));
  useBotStore.getState().select(null);
  useBotStore.getState().openConversation('session-1', id);
  assert.equal(useBotStore.getState().openSessionId, 'session-1');
  assert.equal(useBotStore.getState().selectedId, id);
  useBotStore.getState().openConversation('session-2', 'missing');
  assert.equal(useBotStore.getState().selectedId, id);
  useBotStore.getState().markSeen('session-1');
  assert.ok(useBotStore.getState().seen['session-1']);
  useBotStore.getState().openConversation(null);
  assert.equal(useBotStore.getState().openSessionId, null);
});
