/**
 * Agent CLIs known to speak the Agent Client Protocol, with the command and arguments
 * their own documentation gives for it. A preset only fills in the Add agent form; the
 * person can change every value, and sign-in stays with the CLI.
 */
export interface AcpPreset {
  id: string;
  name: string;
  /** Command names to look for, most specific first. */
  binaries: string[];
  /** Command names used on Windows instead, where the usual one means something else. */
  windowsBinaries?: string[];
  args: string[];
  /** Where to install it and sign in. */
  url: string;
  /** A version requirement or other thing to know before adding it. */
  note?: string;
}

export const ACP_PRESETS: AcpPreset[] = [
  {
    id: 'cursor',
    name: 'Cursor',
    binaries: ['cursor-agent'],
    args: ['acp'],
    url: 'https://cursor.com/cli',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    binaries: ['copilot'],
    args: ['--acp'],
    url: 'https://github.com/github/copilot-cli',
    note: 'Needs Copilot CLI 1.0.93 or newer.',
  },
  {
    id: 'goose',
    name: 'Goose',
    binaries: ['goose'],
    args: ['acp'],
    url: 'https://block.github.io/goose/',
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    binaries: ['qwen'],
    args: ['--acp'],
    url: 'https://github.com/QwenLM/qwen-code',
    note: 'Needs Qwen Code 0.16 or newer.',
  },
  {
    id: 'auggie',
    name: 'Auggie',
    binaries: ['auggie'],
    args: ['--acp'],
    url: 'https://www.augmentcode.com/',
  },
  {
    id: 'kiro',
    name: 'Kiro',
    binaries: ['kiro-cli'],
    args: ['acp'],
    url: 'https://kiro.dev/',
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    binaries: ['hermes'],
    args: ['acp'],
    url: 'https://github.com/NousResearch/hermes-agent',
  },
  {
    id: 'command-code',
    name: 'Command Code',
    binaries: ['cmd'],
    // `cmd` is the Windows command prompt.
    windowsBinaries: ['cmdc'],
    args: ['acp'],
    url: 'https://commandcode.ai',
  },
];

const presetBinaries = (preset: AcpPreset, windows: boolean) =>
  (windows && preset.windowsBinaries) || preset.binaries;

/** Every command name worth looking for on this platform. */
export const presetCommandNames = (windows: boolean) => [
  ...new Set(ACP_PRESETS.flatMap((preset) => presetBinaries(preset, windows))),
];

/** Where a preset's CLI is installed, from the located commands, if it is. */
export function presetPath(preset: AcpPreset, located: Record<string, string>, windows: boolean) {
  for (const name of presetBinaries(preset, windows)) if (located[name]) return located[name];
  return undefined;
}

/** Presets with installed ones first, each in catalog order. */
export function orderedPresets(located: Record<string, string>, windows: boolean) {
  const found = (preset: AcpPreset) => !!presetPath(preset, located, windows);
  return [...ACP_PRESETS.filter(found), ...ACP_PRESETS.filter((preset) => !found(preset))];
}

/** Splits an arguments field on spaces, keeping quoted values together. */
export function splitArguments(text: string) {
  return [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3],
  );
}
