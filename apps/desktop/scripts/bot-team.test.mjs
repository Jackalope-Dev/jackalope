import assert from 'node:assert/strict';
import test from 'node:test';
import { exportBotTeam, parseBotTeam, teamFileName, uniqueBotNames } from '../src/lib/bot-team.ts';

const bot = (patch = {}) => ({
  id: 'b1',
  name: 'Reviewer',
  role: 'Reads every change',
  instructions: 'Review changes carefully.',
  agent: 'claude',
  model: { id: 'opus', name: 'Opus' },
  projectId: 'p1',
  projectIds: ['p2'],
  connectionIds: ['c1'],
  routineIds: ['s1'],
  collaborate: false,
  pinned: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  appearance: { style: 'cat', color: 'teal' },
  wakes: [
    {
      id: 'w1',
      name: 'Morning',
      prompt: 'Review open work.',
      enabled: true,
      projectId: 'p2',
      trigger: { kind: 'schedule', expression: '0 9 * * 1-5', timezone: 'Europe/Paris' },
    },
    {
      id: 'w2',
      name: 'Inbox',
      prompt: 'Read new mail.',
      enabled: true,
      trigger: {
        kind: 'connection',
        connectionId: 'c1',
        tool: 'list',
        arguments: {},
        intervalMinutes: 15,
      },
    },
  ],
  ...patch,
});

test('a shared file carries who a bot is and nothing about this computer', () => {
  const { text, notes } = exportBotTeam('Shop bots', [bot()]);
  const file = JSON.parse(text);
  assert.deepEqual(Object.keys(file), ['format', 'version', 'name', 'bots']);
  assert.deepEqual(Object.keys(file.bots[0]).sort(), [
    'appearance',
    'collaborate',
    'instructions',
    'name',
    'role',
    'wakes',
  ]);
  assert.equal(file.bots[0].wakes.length, 1);
  assert.deepEqual(Object.keys(file.bots[0].wakes[0]).sort(), ['name', 'prompt', 'trigger']);
  for (const local of ['p1', 'p2', 'c1', 's1', 'opus', 'claude', 'b1', 'w1'])
    assert.ok(!text.includes(`"${local}"`), local);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /watch a connection/);
});

test('credentials typed into instructions are removed and reported', () => {
  // Assembled here so the fixtures are not credential-shaped literals in the source.
  const token = ['gh', 'p_', 'a1'.repeat(18)].join('');
  const key = ['s', 'k-proj-', 'b2'.repeat(14)].join('');
  const { text, notes } = exportBotTeam('Team', [
    bot({ instructions: `Use ${token} for GitHub.\nThe key is ${key}.`, wakes: [] }),
  ]);
  assert.ok(!text.includes(token));
  assert.ok(!text.includes(key));
  assert.match(text, /Use \[removed\] for GitHub/);
  assert.match(notes[0], /Reviewer's instructions/);
  const labelled = exportBotTeam('Team', [
    bot({ instructions: `password: ${'c3'.repeat(10)}`, wakes: [] }),
  ]);
  assert.match(labelled.text, /password \[removed\]/);
  // Ordinary prose and paths stay as written.
  const plain = exportBotTeam('Team', [
    bot({ instructions: 'Read docs/ARCHITECTURE.md and keep the token budget small.', wakes: [] }),
  ]);
  assert.deepEqual(plain.notes, []);
  assert.match(plain.text, /keep the token budget small/);
});

test('an imported file adds quiet bots with no reach', () => {
  const team = parseBotTeam(exportBotTeam('Shop bots', [bot()]).text);
  assert.equal(team.name, 'Shop bots');
  const [added] = team.bots;
  assert.deepEqual(
    [added.name, added.agent, added.model, added.connectionIds, added.collaborate],
    ['Reviewer', 'auto', null, [], false],
  );
  assert.deepEqual(added.appearance, { style: 'cat', color: 'teal' });
  assert.equal(added.wakes.length, 1);
  assert.equal(added.wakes[0].enabled, false);
  assert.notEqual(added.wakes[0].id, 'w1');
  assert.equal(added.wakes[0].projectId, undefined);
});

test('a file can only say what the format allows', () => {
  const schedule = (name, expression, timezone) => ({
    name,
    prompt: 'x',
    enabled: true,
    trigger: { kind: 'schedule', expression, timezone },
  });
  const team = parseBotTeam(
    JSON.stringify({
      format: 'jackalope-bots',
      version: 1,
      name: 'x'.repeat(200),
      bots: [
        {
          name: '  Helper  ',
          instructions: 'i'.repeat(7000),
          agent: 'codex',
          model: { id: 'gpt', name: 'GPT' },
          connectionIds: null,
          projectId: 'theirs',
          appearance: { style: 'dragon', color: 'teal' },
          wakes: [
            schedule('Bad', 'nope', 'UTC'),
            { name: 'Escape', prompt: 'x', trigger: { kind: 'repoChange', path: '../secrets' } },
            schedule('Zone', '0 9 * * *', 'Mars/Olympus'),
            {
              name: 'Tool',
              prompt: 'x',
              trigger: { kind: 'connection', connectionId: 'c', tool: 't', intervalMinutes: 5 },
            },
          ],
        },
        { name: '' },
        'nonsense',
      ],
    }),
  );
  assert.equal(team.name.length, 80);
  assert.equal(team.bots.length, 1);
  const [added] = team.bots;
  assert.deepEqual(
    [added.name, added.agent, added.model, added.connectionIds],
    ['Helper', 'auto', null, []],
  );
  assert.equal('projectId' in added, false);
  assert.equal(added.instructions.length, 6000);
  assert.equal(added.appearance, undefined);
  assert.deepEqual(
    added.wakes.map((wake) => [wake.name, wake.enabled]),
    [['Zone', false]],
  );
  assert.equal(added.wakes[0].trigger.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal(team.notes.length, 2);
});

test('files that are not bot files say so', () => {
  assert.throws(() => parseBotTeam('not json'), /not a bot file/);
  assert.throws(() => parseBotTeam('{"format":"other","bots":[]}'), /not a bot file/);
  assert.throws(() => parseBotTeam('{"format":"jackalope-bots","version":2,"bots":[]}'), /newer/);
  assert.throws(
    () => parseBotTeam('{"format":"jackalope-bots","version":1,"bots":[{}]}'),
    /no bots/,
  );
  assert.throws(() => parseBotTeam('x'.repeat(600_001)), /too large/);
});

test('imported names avoid saved ones and file names stay plain', () => {
  assert.deepEqual(uniqueBotNames(['Reviewer', 'reviewer', 'Scout'], ['REVIEWER', 'Reviewer 2']), [
    'Reviewer 3',
    'reviewer 4',
    'Scout',
  ]);
  assert.equal(uniqueBotNames(['n'.repeat(60)], ['n'.repeat(60)])[0].length, 60);
  assert.equal(teamFileName('My Shop / API'), 'my-shop-api.jackalope-bots.json');
  assert.equal(teamFileName('???'), 'bots.jackalope-bots.json');
});
