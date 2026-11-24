import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blockedReason,
  deviceCoverage,
  EMPTY_SKILLS_PAGE,
  filterCounts,
  lineDiff,
  orbit,
  parseSkillsPage,
  reach,
  skillSlug,
  syncSummary,
  visibleSkills,
} from '../src/lib/skill-sync.ts';

const card = (overrides = {}) => ({
  id: 'a'.repeat(24),
  syncedId: null,
  name: 'release-notes',
  description: 'Use when writing release notes.',
  scope: 'personal',
  root: 'claude',
  project: null,
  path: '~/.claude/skills/release-notes',
  tracking: 'outside',
  status: 'local',
  blocked: null,
  files: 1,
  characters: 120,
  modifiedAt: '2026-11-20T10:00:00Z',
  error: null,
  holders: [],
  ...overrides,
});
const page = (overrides = {}) => ({
  sync: { ...EMPTY_SKILLS_PAGE.sync, available: true, settingsSync: true, enabled: true },
  skills: [card()],
  devices: [{ id: 'laptop', name: 'Laptop', platform: 'macos', here: true }],
  ...overrides,
});

test('the native page is accepted only with known fields and values', () => {
  assert.deepEqual(parseSkillsPage(page()), page());
  for (const broken of [
    page({ extra: true }),
    page({ skills: [card({ folderContents: 'x' })] }),
    page({ skills: [card({ status: 'pending' })] }),
    page({ skills: [card({ root: 'cursor' })] }),
    page({ skills: [card({ holders: [{ device: 'x', current: true, revision: 2 }] })] }),
    page({ devices: [{ id: 'x', name: null, platform: null, here: true, email: 'a@b.c' }] }),
    { ...page(), sync: { ...page().sync, secret: 'x' } },
  ])
    assert.throws(() => parseSkillsPage(broken), /Invalid skills response/);
});

test('cards show the most urgent first and filter by sync state and search', () => {
  const cards = [
    card({ id: '1', name: 'zeta', status: 'synced', syncedId: 's1' }),
    card({ id: '2', name: 'alpha', status: 'local' }),
    card({ id: '3', name: 'beta', status: 'conflict', syncedId: 's3' }),
    card({ id: '4', name: 'gamma', status: 'blocked', blocked: 'repository' }),
    card({ id: '5', name: 'delta', status: 'synced', syncedId: 's5', error: 'tracked' }),
  ];
  assert.deepEqual(
    visibleSkills(cards, 'all', '').map((item) => item.name),
    ['beta', 'delta', 'zeta', 'alpha', 'gamma'],
  );
  assert.deepEqual(
    visibleSkills(cards, 'synced', '').map((item) => item.name),
    ['beta', 'delta', 'zeta'],
  );
  assert.deepEqual(
    visibleSkills(cards, 'attention', '').map((item) => item.name),
    ['beta', 'delta'],
  );
  assert.deepEqual(
    visibleSkills(cards, 'all', 'GAM').map((item) => item.name),
    ['gamma'],
  );
  assert.deepEqual(filterCounts(cards), { all: 5, synced: 3, local: 2, attention: 2 });
});

test('devices sit on a ring with this computer at the top', () => {
  const devices = [
    { id: 'desk', name: null, platform: 'windows', here: false },
    { id: 'laptop', name: 'Laptop', platform: 'macos', here: true },
    { id: 'linux', name: null, platform: 'linux', here: false },
  ];
  const holders = [
    { device: 'laptop', current: true },
    { device: 'desk', current: false },
  ];
  const nodes = orbit(devices, holders);
  assert.equal(nodes[0].device.id, 'laptop');
  assert.deepEqual([nodes[0].x, nodes[0].y], [50, 12]);
  assert.deepEqual(
    nodes.map((node) => [node.device.id, node.holds, node.current]),
    [
      ['laptop', true, true],
      ['desk', true, false],
      ['linux', false, false],
    ],
  );
  assert.deepEqual(reach(devices, holders), { current: 1, total: 3 });
  for (const node of nodes) assert.ok(node.x >= 0 && node.x <= 100 && node.y >= 0 && node.y <= 100);
});

test('the overview counts a device current only when it holds every synced skill', () => {
  const devices = [
    { id: 'a', name: null, platform: null, here: true },
    { id: 'b', name: null, platform: null, here: false },
    { id: 'c', name: null, platform: null, here: false },
  ];
  const cards = [
    card({
      syncedId: 's1',
      holders: [
        { device: 'a', current: true },
        { device: 'b', current: true },
      ],
    }),
    card({
      syncedId: 's2',
      holders: [
        { device: 'a', current: true },
        { device: 'b', current: false },
      ],
    }),
    card({ holders: [] }),
  ];
  assert.deepEqual(deviceCoverage(cards, devices), [
    { device: 'a', current: true },
    { device: 'b', current: false },
  ]);
});

test('conflicts compare line by line', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nB\nc'), [
    { kind: 'same', text: 'a' },
    { kind: 'removed', text: 'b' },
    { kind: 'added', text: 'B' },
    { kind: 'same', text: 'c' },
  ]);
  assert.deepEqual(lineDiff('same', 'same'), [{ kind: 'same', text: 'same' }]);
  const long = Array.from({ length: 700 }, (_, index) => `line ${index}`).join('\n');
  const whole = lineDiff(long, `${long}\nmore`);
  assert.equal(whole.filter((line) => line.kind === 'same').length, 0);
});

test('names, reasons and the summary line read plainly', () => {
  assert.equal(skillSlug('  Release Notes!  '), 'release-notes');
  assert.equal(skillSlug('--Weekly_review.v2'), 'weekly_review.v2');
  for (const reason of [
    'repository',
    'partlyTracked',
    'tooLarge',
    'tooManyFiles',
    'binary',
    'fileName',
    'name',
    'sensitive',
    'noCommit',
  ])
    assert.ok(blockedReason(reason).length > 10, reason);
  assert.equal(
    syncSummary({ ...EMPTY_SKILLS_PAGE }, false),
    'Connect your Jackalope account to sync skills between your computers.',
  );
  const twoDevices = page({
    skills: [card({ syncedId: 's1' }), card({ id: 'b', syncedId: null })],
    devices: [
      { id: 'a', name: null, platform: null, here: true },
      { id: 'b', name: null, platform: null, here: false },
    ],
  });
  assert.equal(syncSummary(twoDevices, false), '1 skill synced across 2 computers.');
  assert.equal(syncSummary(twoDevices, true), 'Syncing skills…');
  assert.match(
    syncSummary(page({ sync: { ...page().sync, reset: true } }), false),
    /deleted from another computer/,
  );
});
