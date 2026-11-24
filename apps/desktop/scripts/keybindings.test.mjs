import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bindingKeycaps,
  bindingProblem,
  conflictsFor,
  contextApplies,
  defaultKeybindings,
  displayBinding,
  exportKeybindings,
  findConflicts,
  importKeybindings,
  KEYBINDING_ACTIONS,
  keybindingOverrides,
  matchBinding,
  normalizeBinding,
  recordStroke,
  resolveKeybindings,
} from '../src/lib/keybindings.ts';

const MAC = 'MacIntel';
const WIN = 'Win32';
const key = (overrides) => ({
  key: 'k',
  code: 'KeyK',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  repeat: false,
  ...overrides,
});
const env = (overrides = {}) => ({
  terminal: false,
  editable: false,
  dialog: false,
  modal: false,
  composer: false,
  ownFind: false,
  ...overrides,
});

test('defaults keep the shortcuts the app had before the registry', () => {
  for (const platform of [MAC, WIN]) {
    const defaults = defaultKeybindings(platform);
    assert.equal(defaults.search, 'Mod+K');
    assert.equal(defaults.newWork, 'Mod+Shift+N');
    assert.equal(defaults.overview, 'Mod+Shift+O');
    assert.equal(defaults.settings, 'Mod+,');
    assert.equal(defaults.terminal, 'Mod+J');
    assert.equal(defaults.sidebar, 'Mod+B');
    assert.equal(defaults.shortcuts, '?');
    assert.equal(defaults.nextTab, 'Ctrl+Tab');
    assert.equal(defaults.previousTab, 'Ctrl+Shift+Tab');
    assert.equal(defaults.tab1, 'Mod+1');
    assert.equal(defaults.tab9, 'Mod+9');
    assert.equal(defaults.find, 'Mod+F');
    assert.deepEqual(findConflicts(defaults, platform), []);
    for (const action of KEYBINDING_ACTIONS)
      assert.equal(bindingProblem(defaults[action.id], platform), '', action.id);
  }
  assert.equal(defaultKeybindings(MAC).back, 'Mod+[');
  assert.equal(defaultKeybindings(MAC).forward, 'Mod+]');
  assert.equal(defaultKeybindings(WIN).back, 'Alt+ArrowLeft');
  assert.equal(defaultKeybindings('Linux x86_64').forward, 'Alt+ArrowRight');
});

test('Mod follows the platform and the event must press exactly the bound keys', () => {
  const ctrlK = key({ ctrlKey: true });
  const cmdK = key({ metaKey: true });
  assert.equal(matchBinding(ctrlK, 'Mod+K', null, WIN), 'full');
  assert.equal(matchBinding(ctrlK, 'Mod+K', null, MAC), null);
  assert.equal(matchBinding(cmdK, 'Mod+K', null, MAC), 'full');
  assert.equal(matchBinding(cmdK, 'Mod+K', null, WIN), null);
  assert.equal(matchBinding({ ...ctrlK, shiftKey: true }, 'Mod+K', null, WIN), null);
  assert.equal(matchBinding({ ...ctrlK, isComposing: true }, 'Mod+K', null, WIN), null);
  assert.equal(matchBinding(ctrlK, '', null, WIN), null);
  // Shift and Option change the character; the physical key still matches.
  assert.equal(
    matchBinding(
      key({ ctrlKey: true, shiftKey: true, key: '!', code: 'Digit1' }),
      'Mod+Shift+1',
      null,
      WIN,
    ),
    'full',
  );
  assert.equal(
    matchBinding(key({ metaKey: true, altKey: true, key: '˚' }), 'Mod+Alt+K', null, MAC),
    'full',
  );
  assert.equal(
    matchBinding(
      key({ metaKey: true, shiftKey: true, key: '{', code: 'BracketLeft' }),
      'Mod+Shift+[',
      null,
      MAC,
    ),
    'full',
  );
  // Ctrl is its own key on macOS and the same key as Mod elsewhere.
  const ctrlTab = key({ ctrlKey: true, key: 'Tab', code: 'Tab' });
  assert.equal(matchBinding(ctrlTab, 'Ctrl+Tab', null, MAC), 'full');
  assert.equal(matchBinding(ctrlTab, 'Ctrl+Tab', null, WIN), 'full');
  assert.equal(matchBinding(ctrlTab, 'Mod+Tab', null, WIN), 'full');
  assert.equal(matchBinding(ctrlTab, 'Mod+Tab', null, MAC), null);
  // ? matches by character, wherever the layout puts it.
  assert.equal(
    matchBinding(key({ key: '?', shiftKey: true, code: 'Slash' }), '?', null, WIN),
    'full',
  );
  assert.equal(
    matchBinding(key({ key: '?', shiftKey: true, code: 'KeyM' }), '?', null, WIN),
    'full',
  );
  assert.equal(
    matchBinding(key({ key: '?', shiftKey: true, ctrlKey: true }), '?', null, WIN),
    null,
  );
  assert.equal(
    matchBinding(
      key({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }),
      'Alt+ArrowLeft',
      null,
      WIN,
    ),
    'full',
  );
});

test('a chord matches its first key as a prefix, then both keys in order', () => {
  const first = key({ metaKey: true });
  const second = key({ key: 'm', code: 'KeyM' });
  assert.equal(matchBinding(first, 'Mod+K M', null, MAC), 'prefix');
  assert.equal(matchBinding(second, 'Mod+K M', first, MAC), 'full');
  assert.equal(matchBinding(second, 'Mod+K M', null, MAC), null);
  assert.equal(matchBinding(key({ key: 'x', code: 'KeyX' }), 'Mod+K M', first, MAC), null);
  assert.equal(displayBinding('Mod+K M', MAC), '⌘+K then M');
  assert.deepEqual(bindingKeycaps('Mod+Shift+K M', MAC), [['⌘', '⇧', 'K'], ['M']]);
});

test('bindings normalize, and editing, window and typing keys are refused', () => {
  assert.equal(normalizeBinding(' shift + mod + p '), 'Mod+Shift+P');
  assert.equal(normalizeBinding('cmd+option+left'), 'Mod+Alt+ArrowLeft');
  assert.equal(normalizeBinding('ctrl+k   m'), 'Ctrl+K M');
  for (const value of ['Mod+Mod+K', 'Mod+Hyper+K', 'Shift+?', 'A B C', 'Mod+'])
    assert.equal(normalizeBinding(value), null, value);
  for (const value of [
    'Mod+V',
    'Mod+Q',
    'Mod+Shift+W',
    'Ctrl+A',
    'Mod+H',
    'Escape',
    'Mod+K Escape',
    'Enter',
    'Shift+ArrowUp',
    'Tab',
    'nonsense',
  ])
    assert.notEqual(bindingProblem(value, MAC), '', value);
  assert.notEqual(bindingProblem('Alt+E', MAC), '');
  assert.equal(bindingProblem('Alt+E', WIN), '');
  // macOS window menu keys are free elsewhere, so a saved Ctrl+H keeps working there.
  assert.equal(bindingProblem('Mod+H', WIN), '');
  assert.equal(resolveKeybindings({ search: 'Mod+H' }, WIN).search, 'Mod+H');
  assert.equal(normalizeBinding(`Mod+${' '.repeat(200)}K`), null);
  for (const value of ['Mod+Shift+P', 'Mod+Enter', 'F5', 'G', '?', 'Mod+K M', 'Alt+ArrowLeft'])
    assert.equal(bindingProblem(value, MAC), '', value);
});

test('saved bindings from before the registry keep working', () => {
  const defaults = defaultKeybindings(WIN);
  assert.deepEqual(resolveKeybindings(null, WIN), defaults);
  assert.deepEqual(resolveKeybindings({}, WIN), defaults);
  // The old settings page saved all five actions together.
  const legacy = {
    search: 'Mod+Shift+P',
    newWork: 'Mod+Shift+N',
    settings: 'Mod+,',
    terminal: 'Mod+J',
    sidebar: 'Mod+B',
  };
  const resolved = resolveKeybindings(legacy, WIN);
  assert.equal(resolved.search, 'Mod+Shift+P');
  // Plan mode was added later with that default, so it gives way rather than clash.
  assert.equal(resolved.planMode, '');
  assert.equal(resolved.agentPicker, 'Mod+Shift+M');
  assert.deepEqual(findConflicts(resolved, WIN), []);
  // A saved Mod+F keeps working; find, added later, has none until the person picks one.
  const withFind = resolveKeybindings({ ...legacy, sidebar: 'Mod+F' }, WIN);
  assert.equal(withFind.sidebar, 'Mod+F');
  assert.equal(withFind.find, '');
  // Overview arrived the same way: a saved Mod+Shift+O keeps its action.
  const withOverview = resolveKeybindings({ ...legacy, newWork: 'Mod+Shift+O' }, WIN);
  assert.equal(withOverview.newWork, 'Mod+Shift+O');
  assert.equal(withOverview.overview, '');
  // The Overview build saved all six together, and those stay as saved.
  assert.equal(
    resolveKeybindings({ ...legacy, overview: 'Mod+Shift+Y' }, WIN).overview,
    'Mod+Shift+Y',
  );
  // Data saved by the find build itself is honoured.
  assert.equal(resolveKeybindings({ find: 'Mod+Shift+F' }, WIN).find, 'Mod+Shift+F');
  // A clash among the original actions, as in data edited by hand, restores every default.
  assert.deepEqual(resolveKeybindings({ search: 'Mod+,' }, WIN), defaults);
  // Unreadable or refused entries keep their default.
  assert.equal(resolveKeybindings({ search: 'Mod+V', terminal: 42 }, WIN).search, 'Mod+K');
  assert.equal(resolveKeybindings({ search: 'mod + shift + p' }, WIN).search, 'Mod+Shift+P');
  // A cleared action stays unassigned.
  assert.equal(resolveKeybindings({ terminal: '' }, WIN).terminal, '');
  // Two saved actions on one key restore the defaults.
  assert.deepEqual(
    resolveKeybindings({ terminal: 'Mod+Shift+M', agentPicker: 'Mod+Shift+M' }, WIN),
    defaults,
  );
});

test('saving keeps only the changes and treats Ctrl and Mod as one key off macOS', () => {
  const bindings = {
    ...defaultKeybindings(WIN),
    search: 'Mod+P',
    terminal: '',
    nextTab: 'Mod+Tab',
  };
  assert.deepEqual(keybindingOverrides(bindings, WIN), { search: 'Mod+P', terminal: '' });
  assert.deepEqual(resolveKeybindings(keybindingOverrides(bindings, WIN), WIN).nextTab, 'Ctrl+Tab');
  assert.deepEqual(keybindingOverrides(defaultKeybindings(MAC), MAC), {});
});

test('conflicts name the other action, including chords that start with a bound key', () => {
  const bindings = defaultKeybindings(MAC);
  assert.deepEqual(conflictsFor(bindings, 'terminal', 'Mod+K', MAC), ['search']);
  assert.deepEqual(conflictsFor(bindings, 'terminal', 'Mod+K M', MAC), ['search']);
  assert.deepEqual(conflictsFor(bindings, 'search', 'Mod+K', MAC), []);
  assert.deepEqual(conflictsFor(bindings, 'terminal', 'Mod+Shift+J', MAC), []);
  assert.deepEqual(conflictsFor(bindings, 'search', 'Shift+/', MAC), ['shortcuts']);
  assert.deepEqual(
    findConflicts({ ...bindings, terminal: 'Mod+K' }, MAC).map((pair) => pair.join(' ')),
    ['search terminal'],
  );
  // On Windows Ctrl+Tab and Mod+Tab are the same keys.
  assert.deepEqual(conflictsFor(defaultKeybindings(WIN), 'search', 'Mod+Tab', WIN), ['nextTab']);
  assert.deepEqual(conflictsFor(defaultKeybindings(MAC), 'search', 'Mod+Tab', MAC), []);
});

test('contexts keep terminals, text fields and finds that belong to a view', () => {
  assert.equal(contextApplies('anywhere', 'Mod+K', env({ terminal: true })), true);
  assert.equal(contextApplies('outsideTerminal', 'Mod+Shift+G', env({ terminal: true })), false);
  assert.equal(contextApplies('anywhere', 'Mod+K', env({ editable: true })), true);
  // Keys that type stay in the field or terminal.
  assert.equal(contextApplies('outsideText', '?', env({ editable: true })), false);
  assert.equal(contextApplies('outsideText', '?', env({ dialog: true })), false);
  assert.equal(contextApplies('outsideText', '?', env()), true);
  assert.equal(contextApplies('anywhere', 'G', env({ editable: true })), false);
  assert.equal(contextApplies('anywhere', 'G', env({ terminal: true })), false);
  assert.equal(contextApplies('composer', 'G', env({ editable: true, composer: true })), false);
  assert.equal(contextApplies('composer', 'G', env()), true);
  assert.equal(contextApplies('composer', 'F5', env({ editable: true, composer: true })), true);
  assert.equal(contextApplies('anywhere', 'F5', env({ terminal: true })), false);
  assert.equal(contextApplies('conversation', 'Mod+F', env()), true);
  assert.equal(contextApplies('conversation', 'Mod+F', env({ ownFind: true })), false);
  assert.equal(contextApplies('conversation', 'Mod+F', env({ terminal: true })), false);
  assert.equal(contextApplies('conversation', 'Mod+F', env({ dialog: true })), false);
  assert.equal(contextApplies('composer', 'Mod+Shift+M', env()), true);
  assert.equal(
    contextApplies('composer', 'Mod+Shift+M', env({ modal: true, dialog: true })),
    false,
  );
  assert.equal(contextApplies('composer', 'Mod+Shift+M', env({ terminal: true })), false);
  assert.equal(contextApplies('composerFocus', 'Mod+Enter', env()), false);
  assert.equal(
    contextApplies('composerFocus', 'Mod+Enter', env({ composer: true, editable: true })),
    true,
  );
});

test('recording turns key presses into bindings for this platform', () => {
  assert.equal(
    recordStroke(key({ metaKey: true, shiftKey: true, key: 'M', code: 'KeyM' }), MAC),
    'Mod+Shift+M',
  );
  assert.equal(recordStroke(key({ ctrlKey: true, key: 'Tab', code: 'Tab' }), MAC), 'Ctrl+Tab');
  assert.equal(recordStroke(key({ ctrlKey: true, key: 'Tab', code: 'Tab' }), WIN), 'Mod+Tab');
  assert.equal(recordStroke(key({ shiftKey: true, key: '?', code: 'Slash' }), WIN), '?');
  assert.equal(recordStroke(key({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), WIN), null);
  assert.equal(recordStroke(key({ metaKey: true, key: 'k' }), WIN), null);
  assert.equal(
    recordStroke(key({ altKey: true, key: 'ArrowLeft', code: 'ArrowLeft' }), WIN),
    'Alt+ArrowLeft',
  );
  assert.equal(recordStroke(key({ ctrlKey: true, key: 'л', code: 'KeyK' }), WIN), 'Mod+K');
});

test('export holds the changes and import replaces them after checking every entry', () => {
  const bindings = { ...defaultKeybindings(MAC), search: 'Mod+P', terminal: '' };
  const exported = exportKeybindings(bindings, MAC);
  assert.deepEqual(JSON.parse(exported).bindings, { search: 'Mod+P', terminal: '' });
  const imported = importKeybindings(exported, MAC);
  assert.deepEqual(imported.overrides, { search: 'Mod+P', terminal: '' });
  assert.deepEqual(imported.ignored, []);
  // A plain object works too; unknown actions are skipped and named.
  const plain = importKeybindings('{"newWork":"mod+shift+u","later":"Mod+L"}', MAC);
  assert.deepEqual(plain.overrides, { newWork: 'Mod+Shift+U' });
  assert.deepEqual(plain.ignored, ['later']);
  // An imported binding takes a default the file does not mention.
  assert.deepEqual(importKeybindings('{"terminal":"Mod+K"}', MAC).overrides, {
    terminal: 'Mod+K',
    search: '',
  });
  assert.match(importKeybindings('not json', MAC).error, /not valid JSON/);
  assert.match(importKeybindings('[1]', MAC).error, /Expected an object/);
  assert.match(
    importKeybindings('{"search":"Mod+V"}', MAC).error,
    /Search and commands: .*reserved/,
  );
  assert.match(importKeybindings('{"search":"Hyper+K"}', MAC).error, /is not a shortcut/);
  // Oversized text is refused before parsing, so a crafted file cannot stall the window.
  const started = Date.now();
  assert.match(
    importKeybindings(JSON.stringify({ search: `Mod${' '.repeat(200_000)}K` }), MAC).error,
    /too long/,
  );
  assert.ok(Date.now() - started < 1000);
  assert.match(
    importKeybindings('{"search":"Mod+J","terminal":"Mod+J"}', MAC).error,
    /Search and commands and Open terminal use the same shortcut/,
  );
});
