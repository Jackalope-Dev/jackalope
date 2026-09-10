export function primaryModifier(platform = globalThis.navigator?.platform ?? ''): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? '⌘' : 'Ctrl';
}

export function shortcutLabel(keys: string, platform?: string): string {
  return `${primaryModifier(platform)}+${keys}`;
}
