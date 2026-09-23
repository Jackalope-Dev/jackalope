import { primaryModifier } from './platform-shortcuts.ts';

export const defaultShortcuts = { search: 'Mod+K', newWork: 'Mod+Shift+N', settings: 'Mod+,' };
export type ShortcutAction = keyof typeof defaultShortcuts;
export const shortcutNames: Record<ShortcutAction, string> = {
  search: 'Search and commands',
  newWork: 'New work',
  settings: 'Settings',
};

export function normalizeShortcut(value: string): string | null {
  const parts = value
    .trim()
    .split('+')
    .map((part) => part.trim());
  const key = parts.pop()?.toUpperCase();
  if (!key || !/^(?:[A-Z0-9,./;[\]`=-]|F(?:[1-9]|1[0-2]))$/.test(key)) return null;
  const modifiers = new Set(parts.map((part) => part.toLowerCase()));
  if (
    modifiers.size !== parts.length ||
    parts.some((part) => !['mod', 'shift', 'alt'].includes(part.toLowerCase()))
  )
    return null;
  if (!modifiers.has('mod')) return null;
  if (['C', 'V', 'X', 'A', 'Z', 'Q', 'W', 'R', 'L', 'T'].includes(key)) return null;
  return [
    'Mod',
    ...(modifiers.has('shift') ? ['Shift'] : []),
    ...(modifiers.has('alt') ? ['Alt'] : []),
    key,
  ].join('+');
}

export function resolveShortcuts(saved: unknown): typeof defaultShortcuts {
  const result = { ...defaultShortcuts };
  if (!saved || typeof saved !== 'object') return result;
  for (const action of Object.keys(result) as ShortcutAction[]) {
    const value = (saved as Record<string, unknown>)[action];
    if (typeof value === 'string') {
      const normalized = normalizeShortcut(value);
      if (normalized) result[action] = normalized;
    }
  }
  return new Set(Object.values(result)).size === Object.keys(result).length
    ? result
    : { ...defaultShortcuts };
}

export function matchesShortcut(
  event: Pick<
    KeyboardEvent,
    'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'repeat'
  > & { code?: string },
  binding: string,
  platform = globalThis.navigator?.platform ?? '',
): boolean {
  if (event.isComposing || event.repeat) return false;
  const parts = binding.split('+');
  const mac = primaryModifier(platform) === '⌘';
  let key = event.key.toUpperCase();
  if ((event.altKey || event.shiftKey) && !/^[A-Z0-9,./;[\]`=-]$/.test(key)) {
    const punctuation: Record<string, string> = {
      Comma: ',',
      Period: '.',
      Slash: '/',
      Semicolon: ';',
      BracketLeft: '[',
      BracketRight: ']',
      Backquote: '`',
      Equal: '=',
      Minus: '-',
    };
    const code = event.code ?? '';
    key = /^(?:Key[A-Z]|Digit[0-9])$/.test(code)
      ? code.replace(/^(?:Key|Digit)/, '')
      : (punctuation[code] ?? key);
  }
  return (
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
    event.altKey === parts.includes('Alt') &&
    event.shiftKey === parts.includes('Shift') &&
    key === parts.at(-1)?.toUpperCase()
  );
}

export function displayShortcut(binding: string): string {
  return binding.replace('Mod', primaryModifier());
}
