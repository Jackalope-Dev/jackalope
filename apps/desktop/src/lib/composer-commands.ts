/**
 * Slash commands and `@` file mentions in the desktop composers. The terminal composer
 * (docs/CLI.md) has its own list; these share its shape: `/name` at the start of the
 * draft, an optional argument after a space, and `@path` mentions that start the draft
 * or follow whitespace. A command the composer does not run itself is sent unchanged.
 */

type ComposerCommandId = 'model' | 'effort' | 'clear' | 'btw' | 'plan' | 'provider';

export interface ComposerCommand {
  id: ComposerCommandId;
  name: string;
  description: string;
  /** Shown after the name in the menu, such as `<question>`. */
  argument?: string;
}

/** What the composer offers; a command appears only when its feature exists here. */
export interface ComposerCommandContext {
  model?: boolean;
  effort?: boolean;
  /** A new conversation can be started from here, keeping this one. */
  clear?: boolean;
  /** Side questions are possible here, even when this agent cannot answer them. */
  btw?: boolean;
  plan?: boolean;
  /** The agent's own commands or skills Jackalope could discover. */
  provider?: { name: string; description: string }[];
}

const BUILT_IN: (ComposerCommand & { when: keyof ComposerCommandContext })[] = [
  { id: 'model', name: 'model', description: 'Choose the agent and model', when: 'model' },
  { id: 'effort', name: 'effort', description: 'Choose how hard the model thinks', when: 'effort' },
  {
    id: 'clear',
    name: 'clear',
    description: 'Start a new conversation; this one stays',
    when: 'clear',
  },
  {
    id: 'btw',
    name: 'btw',
    description: 'Ask a quick side question without adding it to this work',
    argument: '<question>',
    when: 'btw',
  },
  { id: 'plan', name: 'plan', description: 'Plan with me before starting', when: 'plan' },
];

export function composerCommands(context: ComposerCommandContext): ComposerCommand[] {
  const builtIn = BUILT_IN.filter((command) => context[command.when]).map(
    ({ when: _when, ...command }) => command,
  );
  const taken = new Set(builtIn.map((command) => command.name));
  const provider = (context.provider ?? [])
    .filter((command) => /^[\w:.-]+$/.test(command.name) && !taken.has(command.name))
    .map((command) => ({ id: 'provider' as const, ...command }));
  return [...builtIn, ...provider];
}

/** Commands whose name starts with what was typed, built-in commands first. */
export function matchCommands(commands: ComposerCommand[], typed: string) {
  const query = typed.toLowerCase();
  return commands.filter((command) => command.name.toLowerCase().startsWith(query));
}

/**
 * The command being typed: `/` starts the draft, the caret is still in its name and
 * nothing follows it, so choosing a command never replaces text typed after it.
 */
export function slashQuery(text: string, caret: number): string | null {
  if (!text.startsWith('/')) return null;
  const name = text.slice(1, caret);
  if (caret < 1 || /\s/.test(name)) return null;
  if (/\s/.test(text.slice(caret).trimEnd())) return null;
  return name;
}

/** A complete command line: its name and the text after it. */
export function parseCommand(text: string): { name: string; argument: string } | null {
  const match = /^\/([\w:.-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  return { name: match[1].toLowerCase(), argument: (match[2] ?? '').trim() };
}

/** The `@` mention under the caret: where it starts and what follows the `@`. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  let start = caret;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  if (text[start] !== '@') return null;
  const query = text.slice(start + 1, caret);
  if (query.includes('@')) return null;
  return { start, query };
}

/** The draft with the mention replaced by `@path`, and the caret after it. */
export function insertMention(text: string, start: number, caret: number, path: string) {
  let end = caret;
  while (end < text.length && !/\s/.test(text[end])) end++;
  const token = /\s/.test(path) ? `@"${path}"` : `@${path}`;
  const after = text.slice(end);
  const spaced = after.startsWith(' ') || after.startsWith('\n') ? after : ` ${after}`;
  return { text: `${text.slice(0, start)}${token}${spaced}`, caret: start + token.length + 1 };
}

/**
 * Whether a key belongs to an IME composition. WebKit sends the Enter that commits a
 * composition after `compositionend`, as key code 229 with `isComposing` already false.
 */
export function composingKey(event: { isComposing: boolean; keyCode: number }) {
  return event.isComposing || event.keyCode === 229;
}
