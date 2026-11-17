import {
  BOT_COLORS,
  BOT_INSTRUCTIONS_MAX,
  BOT_NAME_MAX,
  BOT_STYLES,
  BOT_WAKES_MAX,
  type Bot,
  type BotAppearance,
  type BotDraft,
  type BotWake,
  validateWake,
  WAKE_PROMPT_MAX,
} from '../stores/botStore.ts';

/**
 * A shareable set of bots. The format is an allowlist: who each bot is, how it looks and
 * what wakes it. It has no field for an agent, model, project, connection, note or
 * conversation, so a file can never widen what a bot may reach on the computer that adds it.
 */
interface BotTeam {
  format: typeof TEAM_FORMAT;
  version: 1;
  name: string;
  bots: TeamBot[];
}

interface TeamBot {
  name: string;
  role: string;
  instructions: string;
  appearance?: BotAppearance;
  collaborate: boolean;
  wakes: TeamWake[];
}

interface TeamWake {
  name: string;
  prompt: string;
  trigger:
    | { kind: 'schedule'; expression: string; timezone: string }
    | { kind: 'repoChange'; path: string };
}

const TEAM_FORMAT = 'jackalope-bots';
export const TEAM_FILE_SUFFIX = '.jackalope-bots.json';
const TEAM_BOTS_MAX = 30;
export const TEAM_TEXT_MAX = 600_000;
const TEAM_NAME_MAX = 80;
const ROLE_MAX = 200;

/** Text that looks like a credential someone typed into instructions or a prompt. */
const SECRETS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:sk|pk|rk)-(?:[A-Za-z]+-)*[A-Za-z0-9_-]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b(?:Bearer|token|password|passwd|secret|api[_-]?key)\b(\s*[:=]\s*|\s+)["']?[A-Za-z0-9_\-./+]{16,}["']?/gi,
];
const REMOVED = '[removed]';

function withoutSecrets(text: string) {
  let changed = false;
  let next = text;
  for (const pattern of SECRETS)
    next = next.replace(pattern, (match) => {
      changed = true;
      // Keep the word that introduced the value so the sentence still reads.
      const label = /^(Bearer|token|password|passwd|secret|api[_-]?key)\b/i.exec(match)?.[0];
      return label ? `${label} ${REMOVED}` : REMOVED;
    });
  return { text: next, changed };
}

export interface TeamExport {
  text: string;
  /** What was changed or could not travel, in the person's words. */
  notes: string[];
}

/** Writes a team file from saved bots, leaving out what cannot or should not travel. */
export function exportBotTeam(name: string, bots: Bot[]): TeamExport {
  const notes: string[] = [];
  const clean = (text: string, where: string) => {
    const result = withoutSecrets(text);
    if (result.changed) notes.push(`Removed what looks like a key or password from ${where}.`);
    return result.text;
  };
  const team: BotTeam = {
    format: TEAM_FORMAT,
    version: 1,
    name: name.trim().slice(0, TEAM_NAME_MAX) || 'Bots',
    bots: bots.slice(0, TEAM_BOTS_MAX).map((bot) => {
      const skipped = bot.wakes.filter((wake) => wake.trigger.kind === 'connection').length;
      if (skipped)
        notes.push(
          `Left out ${skipped} of ${bot.name}'s wake-ups that watch a connection on this computer.`,
        );
      return {
        name: bot.name,
        role: clean(bot.role, `${bot.name}'s description`),
        instructions: clean(bot.instructions, `${bot.name}'s instructions`),
        appearance: bot.appearance,
        collaborate: bot.collaborate,
        wakes: bot.wakes.flatMap((wake): TeamWake[] =>
          wake.trigger.kind === 'connection'
            ? []
            : [
                {
                  name: wake.name,
                  prompt: clean(wake.prompt, `${bot.name}'s wake-up “${wake.name}”`),
                  trigger: wake.trigger,
                },
              ],
        ),
      };
    }),
  };
  if (bots.length > TEAM_BOTS_MAX)
    notes.push(`Only the first ${TEAM_BOTS_MAX} bots fit in one file.`);
  return { text: `${JSON.stringify(team, null, 2)}\n`, notes };
}

export function teamFileName(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || 'bots'}${TEAM_FILE_SUFFIX}`;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) =>
  typeof value === 'string' ? [...value.trim()].slice(0, max).join('') : '';

function parseAppearance(value: unknown): BotAppearance | undefined {
  if (!record(value)) return undefined;
  const style = BOT_STYLES.find((item) => item.id === value.style)?.id;
  const color = BOT_COLORS.find((item) => item.id === value.color)?.id;
  return style && color ? { style, color } : undefined;
}

function parseWake(value: unknown): BotWake | null {
  if (!record(value) || !record(value.trigger)) return null;
  const source = value.trigger;
  const trigger: BotWake['trigger'] | null =
    source.kind === 'schedule'
      ? {
          kind: 'schedule',
          expression: text(source.expression, 120),
          // A zone this computer does not know falls back to its own.
          timezone: knownTimezone(text(source.timezone, 80)),
        }
      : source.kind === 'repoChange'
        ? { kind: 'repoChange', path: text(source.path, 400) }
        : null;
  if (!trigger) return null;
  const wake: BotWake = {
    id: crypto.randomUUID(),
    name: text(value.name, 80),
    prompt: text(value.prompt, WAKE_PROMPT_MAX),
    // Wake-ups from a file never start work until the person turns them on.
    enabled: false,
    trigger,
  };
  return validateWake(wake, null) ? null : wake;
}

function knownTimezone(zone: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}

export interface TeamImport {
  name: string;
  /** Bots ready to add once a project is chosen. */
  bots: Omit<BotDraft, 'projectId'>[];
  /** What the file held that was not brought in. */
  notes: string[];
}

/** Reads a team file. Everything outside the format is ignored; a bad file throws why. */
export function parseBotTeam(source: string): TeamImport {
  if (source.length > TEAM_TEXT_MAX) throw new Error('This file is too large to be a bot file.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('This is not a bot file. Choose a file saved with Share bots.');
  }
  if (!record(parsed) || parsed.format !== TEAM_FORMAT || !Array.isArray(parsed.bots))
    throw new Error('This is not a bot file. Choose a file saved with Share bots.');
  if (parsed.version !== 1)
    throw new Error('This bot file was saved by a newer Jackalope. Update to add it.');
  const notes: string[] = [];
  const bots: TeamImport['bots'] = [];
  for (const entry of parsed.bots.slice(0, TEAM_BOTS_MAX)) {
    if (!record(entry)) continue;
    const name = text(entry.name, BOT_NAME_MAX);
    if (!name) continue;
    const listed = Array.isArray(entry.wakes) ? entry.wakes.slice(0, BOT_WAKES_MAX) : [];
    const wakes = listed.map(parseWake).filter((wake) => wake !== null);
    if (wakes.length < listed.length)
      notes.push(
        `${listed.length - wakes.length} of ${name}'s wake-ups could not be read and were left out.`,
      );
    bots.push({
      name,
      role: text(entry.role, ROLE_MAX),
      instructions: text(entry.instructions, BOT_INSTRUCTIONS_MAX),
      agent: 'auto',
      model: null,
      // No connections until the person chooses them.
      connectionIds: [],
      appearance: parseAppearance(entry.appearance),
      collaborate: entry.collaborate !== false,
      wakes,
    });
  }
  if (!bots.length) throw new Error('This bot file has no bots in it.');
  if (parsed.bots.length > bots.length)
    notes.push(`${parsed.bots.length - bots.length} entries could not be read and were left out.`);
  return { name: text(parsed.name, TEAM_NAME_MAX) || 'Bots', bots, notes };
}

/** Names for imported bots that do not collide with ones already saved. */
export function uniqueBotNames(names: string[], taken: string[]) {
  const used = new Set(taken.map((name) => name.toLowerCase()));
  return names.map((name) => {
    let next = name;
    for (let count = 2; used.has(next.toLowerCase()); count += 1) {
      const suffix = ` ${count}`;
      next = `${[...name].slice(0, BOT_NAME_MAX - suffix.length).join('')}${suffix}`;
    }
    used.add(next.toLowerCase());
    return next;
  });
}
