import assert from 'node:assert/strict';
import test from 'node:test';
import {
  markMigrated,
  planSavedActionsMigration,
  readMigrationMarker,
} from '../src/lib/saved-actions-migration.ts';
import { projectTerminalCommands } from '../src/lib/terminal-commands.ts';
import {
  LEGACY_SAVED_ACTIONS_KEY,
  readLegacySavedActions,
} from '../src/stores/savedActionsStore.ts';

const action = (id, kind, body, projectId = null, name = id) => ({
  id,
  name,
  kind,
  body,
  projectId,
});
const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};
const none = { workflows: [], commands: [], fixedCommands: [] };

test('a project gains its own and all-project saved actions, not other projects', () => {
  const actions = [
    action('Review', 'prompt', 'Review the diff carefully', null),
    action('Mine', 'prompt', 'Only for a', 'a'),
    action('Theirs', 'prompt', 'Only for b', 'b'),
    action('Lint', 'command', 'pnpm lint', null),
    action('Seed', 'command', 'pnpm db:seed', 'a'),
  ];
  const plan = planSavedActionsMigration(actions, 'a', none, ids());
  assert.deepEqual(
    plan.workflows.map((item) => item.title),
    ['Review', 'Mine'],
  );
  assert.deepEqual(plan.commands, [
    { id: 'id-1', name: 'Lint', command: 'pnpm lint' },
    { id: 'id-2', name: 'Seed', command: 'pnpm db:seed' },
  ]);
});

test('duplicates are skipped against the project and within the saved actions', () => {
  const actions = [
    action('Again', 'prompt', '  Review the diff  '),
    action('Copy', 'prompt', 'Review the diff'),
    action('New', 'prompt', 'Write tests'),
    action('Build', 'command', 'pnpm build'),
    action('Test', 'command', 'pnpm test'),
    action('Test twice', 'command', ' pnpm test '),
    action('Known', 'command', 'make docs'),
  ];
  const plan = planSavedActionsMigration(
    actions,
    'a',
    {
      workflows: [{ content: 'Review the diff' }],
      commands: [{ id: 'x', name: 'Docs', command: 'make docs' }],
      fixedCommands: ['pnpm build', undefined, ''],
    },
    ids(),
  );
  assert.deepEqual(
    plan.workflows.map((item) => item.content),
    ['Write tests'],
  );
  assert.deepEqual(
    plan.commands.map((item) => item.command),
    ['pnpm test'],
  );
});

test('long prompts fit workflow limits without breaking characters', () => {
  const body = 'é'.repeat(4000); // 8000 bytes
  const name = `${'Title '.repeat(30)}\nsecond line`;
  const [workflow] = planSavedActionsMigration(
    [action(name, 'prompt', body)],
    'a',
    none,
    ids(),
  ).workflows;
  const bytes = (text) => new TextEncoder().encode(text).length;
  assert.ok(bytes(workflow.content) <= 6000);
  assert.ok(workflow.content.endsWith('…'));
  assert.ok(bytes(workflow.title) <= 120);
  assert.ok(!workflow.title.includes('\n'));
});

test('the migration marker records each project once and the old data is read, not rewritten', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  markMigrated(storage, 'prompts', 'a');
  markMigrated(storage, 'prompts', 'a');
  markMigrated(storage, 'commands', 'b');
  assert.deepEqual(readMigrationMarker(storage), { prompts: ['a'], commands: ['b'] });
  assert.deepEqual(readMigrationMarker({ getItem: () => 'not json' }), {
    prompts: [],
    commands: [],
  });

  const saved = JSON.stringify({
    state: { actions: [action('Ok', 'prompt', 'Hi'), { id: 'bad' }] },
    version: 0,
  });
  values.set(LEGACY_SAVED_ACTIONS_KEY, saved);
  assert.deepEqual(
    readLegacySavedActions(storage).map((item) => item.name),
    ['Ok'],
  );
  assert.equal(values.get(LEGACY_SAVED_ACTIONS_KEY), saved);
  assert.deepEqual(readLegacySavedActions(undefined), []);
});

test('terminal buttons list preparation and verification, then valid extra commands', () => {
  assert.deepEqual(
    projectTerminalCommands({
      prepareCommand: 'pnpm install',
      verifyCommand: ' ',
      terminalCommands: [
        { id: '1', name: 'Seed', command: 'pnpm db:seed' },
        { id: '2', name: '', command: 'blank name' },
        'junk',
      ],
    }).map((item) => item.name),
    ['Prepare workspace', 'Seed'],
  );
  assert.deepEqual(projectTerminalCommands(undefined), []);
});
