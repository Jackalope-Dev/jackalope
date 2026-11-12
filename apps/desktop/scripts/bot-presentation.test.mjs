import assert from 'node:assert/strict';
import test from 'node:test';
import {
  botGreeting,
  groupTemplates,
  nextWakes,
  shuffleAppearance,
  TEMPLATE_GROUPS,
} from '../src/lib/bot-presentation.ts';
import { BOT_TEMPLATES } from '../src/lib/bot-templates.ts';

test('every template lands in exactly one group, unknown ones in the last', () => {
  const groups = groupTemplates([...BOT_TEMPLATES, { id: 'brand-new' }]);
  const ids = groups.flatMap((group) => group.templates.map((template) => template.id));
  assert.equal(ids.length, BOT_TEMPLATES.length + 1);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    groups.map((group) => group.title),
    [...TEMPLATE_GROUPS.map((group) => group.title), 'More bots'],
  );
  assert.deepEqual(groups.at(-1).templates, [{ id: 'brand-new' }]);
  // Every shipped template has a named group.
  assert.equal(groupTemplates(BOT_TEMPLATES).length, TEMPLATE_GROUPS.length);
  assert.deepEqual(groupTemplates([]), []);
});

test('a greeting turns the role into a first-person line', () => {
  assert.equal(
    botGreeting('Reviewer', 'Reviews changes before they merge'),
    "Hi, I'm Reviewer. I'll review changes before they merge.",
  );
  assert.equal(
    botGreeting('Fixer', 'Reproduces and fixes bugs'),
    "Hi, I'm Fixer. I'll reproduce and fix bugs.",
  );
  assert.equal(
    botGreeting('Triage', 'Sorts incoming reports and reproduces real bugs'),
    "Hi, I'm Triage. I'll sort incoming reports and reproduce real bugs.",
  );
  assert.equal(
    botGreeting('Docs', 'Keeps docs and tests in step'),
    "Hi, I'm Docs. I'll keep docs and tests in step.",
  );
  assert.equal(
    botGreeting('Notes', 'Summarizes what shipped.'),
    "Hi, I'm Notes. I'll summarize what shipped.",
  );
  assert.equal(botGreeting('Watch', 'Watches CI'), "Hi, I'm Watch. I'll watch CI.");
  assert.equal(botGreeting('Ally', 'Applies fixes'), "Hi, I'm Ally. I'll apply fixes.");
  assert.equal(botGreeting('Pal', 'release helper'), "Hi, I'm Pal. Release helper.");
  assert.equal(botGreeting('Solo', '  '), "Hi, I'm Solo.");
});

test('shuffle picks a different character and colour', () => {
  const styles = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const colors = [{ id: 'x' }, { id: 'y' }];
  for (const value of [0, 0.5, 0.999999]) {
    const next = shuffleAppearance(styles, colors, { style: 'a', color: 'x' }, () => value);
    assert.notEqual(next.style, 'a');
    assert.equal(next.color, 'y');
  }
  assert.deepEqual(shuffleAppearance([{ id: 'a' }], [{ id: 'x' }], { style: 'a', color: 'x' }), {
    style: 'a',
    color: 'x',
  });
});

test('next wakes keep each bot’s soonest enabled wake within the window', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  const bots = [
    {
      id: 'one',
      wakes: [
        { id: 'w1', enabled: true },
        { id: 'w2', enabled: true },
      ],
    },
    { id: 'two', wakes: [{ id: 'w3', enabled: false }] },
    { id: 'three', wakes: [{ id: 'w4', enabled: true }] },
  ];
  const state = (botId, wakeId, nextCheckAt) => ({ botId, wakeId, nextCheckAt });
  const wakes = nextWakes(
    bots,
    [
      state('one', 'w1', '2026-11-12T20:00:00Z'),
      state('one', 'w2', '2026-11-12T14:00:00Z'),
      state('two', 'w3', '2026-11-12T13:00:00Z'),
      state('three', 'w4', '2026-11-12T13:30:00Z'),
      state('gone', 'w9', '2026-11-12T12:30:00Z'),
      state('three', 'w4', null),
    ],
    now,
  );
  assert.deepEqual(
    wakes.map((wake) => [wake.botId, wake.wakeId]),
    [
      ['three', 'w4'],
      ['one', 'w2'],
    ],
  );
  assert.deepEqual(
    nextWakes(
      bots,
      [state('one', 'w1', '2026-11-14T12:00:00Z'), state('one', 'w2', '2026-11-12T11:00:00Z')],
      now,
    ),
    [],
  );
});
