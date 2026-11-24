import { isMacPlatform, primaryModifier } from './platform-shortcuts.ts';

/**
 * Every app-level keyboard shortcut as a named action with a default binding. Bindings are
 * strings such as `Mod+Shift+N`: `Mod` is Command on macOS and Control elsewhere, `Ctrl`
 * is the Control key everywhere, and a space separates the two keys of a chord
 * (`Mod+K M`). An empty binding is unassigned. Saved bindings are the person's changes
 * from the defaults, keyed by action ID, in `settings.shortcuts`.
 */

/**
 * Where an action applies. A focused terminal keeps every key it sends to the shell
 * (xterm stops those events), and only `anywhere` actions take the keys it lets through.
 * - anywhere: the whole window, text fields included.
 * - outsideTerminal: everywhere but a focused terminal.
 * - outsideText: outside text fields, with no dialog or popover open.
 * - conversation: an open conversation on screen; views with their own find keep the key.
 * - composer: a composer on screen; acts on the focused one, else the one used last.
 * - composerFocus: while typing in a composer.
 */
export type KeybindingContext =
  | 'anywhere'
  | 'outsideTerminal'
  | 'outsideText'
  | 'conversation'
  | 'composer'
  | 'composerFocus';

export type KeybindingGroup = 'Workspace' | 'Open work' | 'Conversation' | 'Composer';

type TabNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type KeybindingId =
  | 'search'
  | 'newWork'
  | 'overview'
  | 'settings'
  | 'terminal'
  | 'sidebar'
  | 'back'
  | 'forward'
  | 'branchMenu'
  | 'shortcuts'
  | 'nextTab'
  | 'previousTab'
  | `tab${TabNumber}`
  | 'find'
  | 'focusComposer'
  | 'send'
  | 'agentPicker'
  | 'effortPicker'
  | 'planMode';

export interface KeybindingAction {
  id: KeybindingId;
  group: KeybindingGroup;
  label: string;
  /** The default binding, or one per platform when macOS conventions differ. */
  binding: string | { mac: string; other: string };
  when: KeybindingContext;
  /** Held keys repeat the action, as when cycling tabs. */
  repeat?: boolean;
}

const TAB_NUMBERS: TabNumber[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export const KEYBINDING_ACTIONS: readonly KeybindingAction[] = [
  {
    id: 'search',
    group: 'Workspace',
    label: 'Search and commands',
    binding: 'Mod+K',
    when: 'anywhere',
  },
  {
    id: 'newWork',
    group: 'Workspace',
    label: 'New work',
    binding: 'Mod+Shift+N',
    when: 'anywhere',
  },
  {
    id: 'overview',
    group: 'Workspace',
    label: 'Open overview',
    binding: 'Mod+Shift+O',
    when: 'anywhere',
  },
  { id: 'settings', group: 'Workspace', label: 'Settings', binding: 'Mod+,', when: 'anywhere' },
  {
    id: 'terminal',
    group: 'Workspace',
    label: 'Open terminal',
    binding: 'Mod+J',
    when: 'anywhere',
  },
  {
    id: 'sidebar',
    group: 'Workspace',
    label: 'Collapse or expand sidebar',
    binding: 'Mod+B',
    when: 'anywhere',
  },
  {
    id: 'back',
    group: 'Workspace',
    label: 'Back',
    binding: { mac: 'Mod+[', other: 'Alt+ArrowLeft' },
    when: 'anywhere',
    repeat: true,
  },
  {
    id: 'forward',
    group: 'Workspace',
    label: 'Forward',
    binding: { mac: 'Mod+]', other: 'Alt+ArrowRight' },
    when: 'anywhere',
    repeat: true,
  },
  {
    id: 'branchMenu',
    group: 'Workspace',
    label: 'Switch or create a branch',
    binding: 'Mod+Shift+G',
    when: 'outsideTerminal',
  },
  {
    id: 'shortcuts',
    group: 'Workspace',
    label: 'Show keyboard shortcuts',
    binding: '?',
    when: 'outsideText',
  },
  {
    id: 'nextTab',
    group: 'Open work',
    label: 'Next tab',
    binding: 'Ctrl+Tab',
    when: 'anywhere',
    repeat: true,
  },
  {
    id: 'previousTab',
    group: 'Open work',
    label: 'Previous tab',
    binding: 'Ctrl+Shift+Tab',
    when: 'anywhere',
    repeat: true,
  },
  ...TAB_NUMBERS.map(
    (number): KeybindingAction => ({
      id: `tab${number}`,
      group: 'Open work',
      label: number === 9 ? 'Go to tab 9 or the last tab' : `Go to tab ${number}`,
      binding: `Mod+${number}`,
      when: 'anywhere',
      repeat: true,
    }),
  ),
  {
    id: 'find',
    group: 'Conversation',
    label: 'Find in conversation',
    binding: 'Mod+F',
    when: 'conversation',
  },
  {
    id: 'focusComposer',
    group: 'Composer',
    label: 'Focus the composer',
    binding: 'Mod+I',
    when: 'anywhere',
  },
  {
    id: 'send',
    group: 'Composer',
    label: 'Send from any composer',
    binding: 'Mod+Enter',
    when: 'composerFocus',
  },
  {
    id: 'agentPicker',
    group: 'Composer',
    label: 'Choose agent and model',
    binding: 'Mod+Shift+M',
    when: 'composer',
  },
  {
    id: 'effortPicker',
    group: 'Composer',
    label: 'Choose effort',
    binding: 'Mod+Shift+E',
    when: 'composer',
  },
  {
    id: 'planMode',
    group: 'Composer',
    label: 'Turn plan mode on or off',
    binding: 'Mod+Shift+P',
    when: 'composer',
  },
];

export const KEYBINDING_GROUPS: readonly KeybindingGroup[] = [
  'Workspace',
  'Open work',
  'Conversation',
  'Composer',
];

/** Where an action applies, for people choosing a binding; empty for the whole window. */
export const CONTEXT_LABELS: Record<KeybindingContext, string> = {
  anywhere: '',
  outsideTerminal: 'Outside the terminal',
  outsideText: 'Outside text fields',
  conversation: 'With a conversation open',
  composer: 'With a composer on screen',
  composerFocus: 'While typing in a composer',
};

const ACTIONS = new Map(KEYBINDING_ACTIONS.map((action) => [action.id, action]));

/** The actions people could rebind before the registry; see `resolveKeybindings`. */
const ORIGINAL_ACTIONS: ReadonlySet<string> = new Set([
  'search',
  'newWork',
  'settings',
  'terminal',
  'sidebar',
]);

export function keybindingAction(id: string): KeybindingAction | undefined {
  return ACTIONS.get(id as KeybindingId);
}

function currentPlatform() {
  return globalThis.navigator?.platform ?? '';
}

export function defaultBinding(action: KeybindingAction, platform = currentPlatform()): string {
  if (typeof action.binding === 'string') return action.binding;
  return isMacPlatform(platform) ? action.binding.mac : action.binding.other;
}

export function defaultKeybindings(platform = currentPlatform()): Record<KeybindingId, string> {
  return Object.fromEntries(
    KEYBINDING_ACTIONS.map((action) => [action.id, defaultBinding(action, platform)]),
  ) as Record<KeybindingId, string>;
}

// Binding syntax.

interface Stroke {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

const CHARACTER = /^[A-Z0-9,./;'[\]\\`=-]$/;
const NAMED_KEYS = [
  'Enter',
  'Tab',
  'Space',
  'Backspace',
  'Delete',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
];
const NAMED = new Map(NAMED_KEYS.map((key) => [key.toLowerCase(), key]));
const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  return: 'Enter',
  del: 'Delete',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};
const MODIFIER_ALIASES: Record<string, keyof Omit<Stroke, 'key'>> = {
  mod: 'mod',
  cmd: 'mod',
  command: 'mod',
  meta: 'mod',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
};
/** Keys whose character already needs Shift; they match by character, so Shift is implied. */
const SHIFTED = new Set(['?']);

function parseKey(value: string): string | null {
  if (SHIFTED.has(value)) return value;
  const upper = value.toUpperCase();
  if (CHARACTER.test(upper)) return upper;
  const lower = value.toLowerCase();
  return NAMED.get(lower) ?? KEY_ALIASES[lower] ?? null;
}

function parseStroke(value: string): Stroke | null {
  const parts = value.split('+').map((part) => part.trim());
  const key = parseKey(parts.pop() ?? '');
  if (!key) return null;
  const stroke: Stroke = { mod: false, ctrl: false, alt: false, shift: false, key };
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (!modifier || stroke[modifier]) return null;
    stroke[modifier] = true;
  }
  if (SHIFTED.has(key) && stroke.shift) return null;
  return stroke;
}

function parseBinding(binding: string): Stroke[] | null {
  const strokes = binding
    .trim()
    .replace(/\s*\+\s*/g, '+')
    .split(/\s+/)
    .map(parseStroke);
  if (!strokes.length || strokes.length > 2 || strokes.some((stroke) => !stroke)) return null;
  return strokes as Stroke[];
}

function formatStroke(stroke: Stroke): string {
  return [
    ...(stroke.mod ? ['Mod'] : []),
    ...(stroke.ctrl ? ['Ctrl'] : []),
    ...(stroke.shift ? ['Shift'] : []),
    ...(stroke.alt ? ['Alt'] : []),
    stroke.key,
  ].join('+');
}

/** A binding in canonical form (`shift + mod + p` → `Mod+Shift+P`), or null when unreadable. */
export function normalizeBinding(binding: string): string | null {
  const strokes = parseBinding(binding);
  return strokes ? strokes.map(formatStroke).join(' ') : null;
}

/** The physical keys a stroke presses here; `Mod` and `Ctrl` are one key off macOS. */
function physical(stroke: Stroke, platform: string): string {
  const mac = isMacPlatform(platform);
  const meta = mac && stroke.mod;
  const ctrl = stroke.ctrl || (!mac && stroke.mod);
  const shifted = SHIFTED.has(stroke.key);
  const key = shifted ? '/' : stroke.key;
  return `${meta ? 'meta+' : ''}${ctrl ? 'ctrl+' : ''}${stroke.alt ? 'alt+' : ''}${
    stroke.shift || shifted ? 'shift+' : ''
  }${key.toUpperCase()}`;
}

/** No Mod, Ctrl or Alt: the stroke types or moves in a text field. */
function plain(stroke: Stroke) {
  return !stroke.mod && !stroke.ctrl && !stroke.alt;
}

const RESERVED_LETTERS = new Set(['C', 'V', 'X', 'A', 'Z', 'Q', 'W', 'R', 'L', 'T']);
/** macOS app menu items the system handles before the window sees the keys. */
const MAC_MENU = new Set(['Mod+H', 'Mod+M', 'Mod+Alt+H', 'Mod+Ctrl+F']);
const MOVEMENT = new Set([
  'Enter',
  'Tab',
  'Space',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

/**
 * Why a binding can't be used, or '' when it can. Editing, window and system keys stay
 * with the system, Escape always closes, and a lone key that types or moves needs a
 * modifier. The second key of a chord can be any key but Escape.
 */
export function bindingProblem(binding: string, platform = currentPlatform()): string {
  const strokes = parseBinding(binding);
  if (!strokes) return 'Use a letter, digit, punctuation, function or arrow key.';
  if (strokes.some((stroke) => stroke.key === 'Escape'))
    return 'Escape always closes dialogs and menus.';
  const [first] = strokes;
  if ((first.mod || first.ctrl) && RESERVED_LETTERS.has(first.key))
    return 'That combination is reserved for editing or the window.';
  if (MAC_MENU.has(formatStroke(first))) return 'macOS uses that combination for the window.';
  if (plain(first) && MOVEMENT.has(first.key))
    return 'That key types or moves around. Add a modifier such as Ctrl or Alt.';
  if (
    isMacPlatform(platform) &&
    first.alt &&
    !first.mod &&
    !first.ctrl &&
    CHARACTER.test(first.key)
  )
    return 'Option with a character types a symbol on macOS. Add Command or Control.';
  return '';
}

// Resolving saved bindings.

/**
 * Saved bindings over the defaults. An action without a saved binding has none while
 * another action's saved binding takes its default, so a choice made before that action
 * existed keeps working. A saved empty binding stays unassigned. If any other clash
 * remains, as in data edited by hand, every default comes back. Unreadable entries keep
 * their default.
 */
export function resolveKeybindings(
  saved: unknown,
  platform = currentPlatform(),
): Record<KeybindingId, string> {
  const defaults = defaultKeybindings(platform);
  if (!saved || typeof saved !== 'object') return defaults;
  const result = { ...defaults };
  const chosen = new Set<KeybindingId>();
  for (const action of KEYBINDING_ACTIONS) {
    const value = (saved as Record<string, unknown>)[action.id];
    if (typeof value !== 'string') continue;
    const binding = value.trim() ? normalizeBinding(value) : '';
    if (binding === null || (binding && bindingProblem(binding, platform))) continue;
    result[action.id] = binding;
    chosen.add(action.id);
  }
  const taken = [...chosen].map((id) => result[id]).filter(Boolean);
  for (const action of KEYBINDING_ACTIONS) {
    if (chosen.has(action.id) || ORIGINAL_ACTIONS.has(action.id)) continue;
    if (taken.some((binding) => overlaps(binding, result[action.id], platform)))
      result[action.id] = '';
  }
  return findConflicts(result, platform).length ? defaults : result;
}

/** Bindings that differ from the defaults, the form `settings.shortcuts` keeps. */
export function keybindingOverrides(
  bindings: Partial<Record<KeybindingId, string>>,
  platform = currentPlatform(),
): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const action of KEYBINDING_ACTIONS) {
    const binding = bindings[action.id];
    if (binding === undefined) continue;
    if (!sameBinding(binding, defaultBinding(action, platform), platform))
      overrides[action.id] = binding;
  }
  return overrides;
}

function sameBinding(a: string, b: string, platform: string) {
  if (!a || !b) return a === b;
  const left = parseBinding(a);
  const right = parseBinding(b);
  return (
    !!left &&
    !!right &&
    left.length === right.length &&
    left.every((stroke, index) => physical(stroke, platform) === physical(right[index], platform))
  );
}

/** Whether two bindings press the same keys, or one is the start of the other's chord. */
function overlaps(a: string, b: string, platform: string) {
  const left = a ? parseBinding(a) : null;
  const right = b ? parseBinding(b) : null;
  if (!left || !right) return false;
  const shared = Math.min(left.length, right.length);
  return left
    .slice(0, shared)
    .every((stroke, index) => physical(stroke, platform) === physical(right[index], platform));
}

/** Pairs of actions whose bindings clash. */
export function findConflicts(
  bindings: Partial<Record<KeybindingId, string>>,
  platform = currentPlatform(),
): [KeybindingId, KeybindingId][] {
  const ids = KEYBINDING_ACTIONS.map((action) => action.id);
  const pairs: [KeybindingId, KeybindingId][] = [];
  ids.forEach((id, index) => {
    for (const other of ids.slice(index + 1))
      if (overlaps(bindings[id] ?? '', bindings[other] ?? '', platform)) pairs.push([id, other]);
  });
  return pairs;
}

/** The actions whose bindings clash with `binding` were `id` to take it. */
export function conflictsFor(
  bindings: Record<KeybindingId, string>,
  id: KeybindingId,
  binding: string,
  platform = currentPlatform(),
): KeybindingId[] {
  return KEYBINDING_ACTIONS.filter(
    (action) => action.id !== id && overlaps(binding, bindings[action.id], platform),
  ).map((action) => action.id);
}

// Import and export.

const EXPORT_FORMAT = 'jackalope-keybindings';

export function exportKeybindings(bindings: Record<KeybindingId, string>, platform?: string) {
  return JSON.stringify(
    { format: EXPORT_FORMAT, version: 1, bindings: keybindingOverrides(bindings, platform) },
    null,
    2,
  );
}

/**
 * Reads exported bindings, or a plain `{ "actionId": "binding" }` object. The result
 * replaces every change from the defaults. Unknown actions are skipped and named;
 * an unreadable or clashing binding rejects the whole file.
 */
export function importKeybindings(
  text: string,
  platform = currentPlatform(),
):
  | { bindings: Record<KeybindingId, string>; overrides: Record<string, string>; ignored: string[] }
  | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'This is not valid JSON.' };
  }
  const record =
    data && typeof data === 'object' && 'bindings' in data
      ? (data as { bindings: unknown }).bindings
      : data;
  if (!record || typeof record !== 'object' || Array.isArray(record))
    return { error: 'Expected an object of action IDs and shortcuts.' };
  const bindings = defaultKeybindings(platform);
  const ignored: string[] = [];
  for (const [id, value] of Object.entries(record)) {
    const action = keybindingAction(id);
    if (!action) {
      ignored.push(id);
      continue;
    }
    if (typeof value !== 'string') return { error: `${action.label}: the shortcut must be text.` };
    const binding = value.trim() ? normalizeBinding(value) : '';
    if (binding === null) return { error: `${action.label}: “${value}” is not a shortcut.` };
    const problem = binding && bindingProblem(binding, platform);
    if (problem) return { error: `${action.label}: ${problem}` };
    bindings[action.id] = binding;
  }
  // Defaults the file does not mention give way to bindings it sets, as saved ones do.
  const named = new Set(Object.keys(record));
  for (const action of KEYBINDING_ACTIONS) {
    if (named.has(action.id)) continue;
    if (
      KEYBINDING_ACTIONS.some(
        (other) =>
          named.has(other.id) && overlaps(bindings[other.id], bindings[action.id], platform),
      )
    )
      bindings[action.id] = '';
  }
  const [clash] = findConflicts(bindings, platform);
  if (clash)
    return {
      error: `${keybindingAction(clash[0])?.label} and ${keybindingAction(clash[1])?.label} use the same shortcut.`,
    };
  return { bindings, overrides: keybindingOverrides(bindings, platform), ignored };
}

// Display.

const KEY_LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** The keys of each stroke as keycaps, with this platform's modifier names. */
export function bindingKeycaps(binding: string, platform = currentPlatform()): string[][] {
  const strokes = binding ? parseBinding(binding) : null;
  if (!strokes) return [];
  const mac = isMacPlatform(platform);
  return strokes.map((stroke) => [
    ...(stroke.mod ? [primaryModifier(platform)] : []),
    ...(stroke.ctrl ? [mac ? '⌃' : 'Ctrl'] : []),
    ...(stroke.shift ? [mac ? '⇧' : 'Shift'] : []),
    ...(stroke.alt ? [mac ? '⌥' : 'Alt'] : []),
    KEY_LABELS[stroke.key] ?? stroke.key,
  ]);
}

/** A binding as text, such as `⌘+Shift+N` or `Ctrl+K then M`; `Not set` when unassigned. */
export function displayBinding(binding: string, platform = currentPlatform()): string {
  const strokes = binding ? parseBinding(binding) : null;
  if (!strokes) return 'Not set';
  return strokes
    .map((stroke) =>
      [
        ...(stroke.mod ? [primaryModifier(platform)] : []),
        ...(stroke.ctrl ? ['Ctrl'] : []),
        ...(stroke.shift ? ['Shift'] : []),
        ...(stroke.alt ? ['Alt'] : []),
        KEY_LABELS[stroke.key] ?? stroke.key,
      ].join('+'),
    )
    .join(' then ');
}

/** A label with its shortcut in brackets, as tooltips show it; the label alone when unset. */
export function withShortcut(label: string, binding: string, platform = currentPlatform()) {
  return binding ? `${label} (${displayBinding(binding, platform)})` : label;
}

// Matching key events.

type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'repeat'
> & { code?: string };

const PUNCTUATION_CODES: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Backquote: '`',
  Equal: '=',
  Minus: '-',
};

/** The key an event names: its character on this layout, or the key under Alt or Shift. */
function eventKey(event: KeyEventLike): string | null {
  const { key } = event;
  if (key === ' ') return 'Space';
  if (key.length === 1) {
    const upper = key.toUpperCase();
    if (CHARACTER.test(upper)) return upper;
  } else {
    const named = parseKey(key);
    if (named) return named;
  }
  // Alt and Shift change the character (⌥K types ˚, Shift+1 types !), so use the key itself.
  const code = event.code ?? '';
  if (/^(?:Key[A-Z]|Digit[0-9])$/.test(code)) return code.replace(/^(?:Key|Digit)/, '');
  return PUNCTUATION_CODES[code] ?? null;
}

/**
 * A pressed key combination as a binding stroke, or null for a lone modifier or a key
 * that cannot be bound. Off macOS the Windows or Super key cannot be bound.
 */
export function recordStroke(event: KeyEventLike, platform = currentPlatform()): string | null {
  if (['Meta', 'Control', 'Shift', 'Alt', 'AltGraph', 'CapsLock'].includes(event.key)) return null;
  const mac = isMacPlatform(platform);
  if (!mac && event.metaKey) return null;
  if (event.key === '?' && !event.metaKey && !event.ctrlKey && !event.altKey) return '?';
  const key = eventKey(event);
  if (!key) return null;
  return formatStroke({
    mod: mac ? event.metaKey : event.ctrlKey,
    ctrl: mac && event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    key,
  });
}

function strokeMatches(event: KeyEventLike, stroke: Stroke, platform: string) {
  // `?` sits on different keys across layouts, so it matches by character.
  if (
    SHIFTED.has(stroke.key) &&
    plain(stroke) &&
    event.key === stroke.key &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  )
    return true;
  const pressed = recordStroke(event, platform);
  const parsed = pressed ? parseStroke(pressed) : null;
  return !!parsed && physical(parsed, platform) === physical(stroke, platform);
}

/**
 * How far `binding` matches the keys pressed so far: `full` when complete, `prefix` when
 * a chord waits for its next key, otherwise null. `previous` holds a chord's first key.
 */
export function matchBinding(
  event: KeyEventLike,
  binding: string,
  previous: KeyEventLike | null = null,
  platform = currentPlatform(),
): 'full' | 'prefix' | null {
  if (!binding || event.isComposing) return null;
  const strokes = parseBinding(binding);
  if (!strokes) return null;
  if (previous) {
    return strokes.length === 2 &&
      strokeMatches(previous, strokes[0], platform) &&
      strokeMatches(event, strokes[1], platform)
      ? 'full'
      : null;
  }
  if (!strokeMatches(event, strokes[0], platform)) return null;
  return strokes.length === 1 ? 'full' : 'prefix';
}

/** Where a key event happened, for matching action contexts. */
export interface KeyEnvironment {
  terminal: boolean;
  /** A text field or editable region has the keys. */
  editable: boolean;
  /** Any dialog or popover is open. */
  dialog: boolean;
  /** A dialog other than a popover is open. */
  modal: boolean;
  /** The keys come from inside a composer. */
  composer: boolean;
  /** The keys come from a view with its own find, marked `data-own-find`. */
  ownFind: boolean;
}

/**
 * Whether an action in `context` takes `binding` here. Keys that type or move (no Mod,
 * Ctrl or Alt) never leave a text field or terminal, except to a composer's own actions.
 */
export function contextApplies(
  context: KeybindingContext,
  binding: string,
  env: KeyEnvironment,
): boolean {
  const strokes = parseBinding(binding);
  if (strokes && plain(strokes[0])) {
    if (env.terminal) return false;
    if (env.editable && !(env.composer && context.startsWith('composer'))) return false;
  }
  if (env.terminal && context !== 'anywhere') return false;
  switch (context) {
    case 'anywhere':
    case 'outsideTerminal':
      return true;
    case 'outsideText':
      return !env.editable && !env.dialog;
    case 'conversation':
      return !env.ownFind && !env.dialog;
    case 'composer':
      return env.composer || !env.modal;
    case 'composerFocus':
      return env.composer;
  }
}
