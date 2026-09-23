export function isMacPlatform(platform = globalThis.navigator?.platform ?? ''): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

export function primaryModifier(platform = globalThis.navigator?.platform ?? ''): string {
  return isMacPlatform(platform) ? '⌘' : 'Ctrl';
}

export function shortcutLabel(keys: string, platform?: string): string {
  return `${primaryModifier(platform)}+${keys}`;
}
