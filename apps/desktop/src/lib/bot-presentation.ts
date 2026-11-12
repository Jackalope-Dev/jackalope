import type { WakeState } from './bot-hub.ts';
import type { BotTemplate } from './bot-templates.ts';

/** Template groups by job; a template not listed here lands in the last group. */
export const TEMPLATE_GROUPS = [
  { id: 'health', title: 'Keep code healthy', ids: ['reviewer', 'tester', 'scout', 'sentinel'] },
  { id: 'fix', title: 'Fix things', ids: ['fixer', 'triage', 'polisher'] },
  { id: 'explain', title: 'Explain', ids: ['researcher', 'docs', 'guide', 'notes'] },
] as const;

const FALLBACK_GROUP = { id: 'more', title: 'More bots' };

/** Templates grouped for the Bots page, in group order, dropping empty groups. */
export function groupTemplates<T extends Pick<BotTemplate, 'id'>>(templates: readonly T[]) {
  const known = new Set<string>(TEMPLATE_GROUPS.flatMap((group) => group.ids));
  const groups: { id: string; title: string; templates: T[] }[] = TEMPLATE_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    templates: group.ids.flatMap((id) => templates.filter((template) => template.id === id)),
  }));
  const rest = templates.filter((template) => !known.has(template.id));
  if (rest.length) groups.push({ ...FALLBACK_GROUP, templates: rest });
  return groups.filter((group) => group.templates.length > 0);
}

/** The base form of a role's leading third-person verb: "Reviews" → "review". */
function firstPerson(verb: string) {
  const lower = verb.toLowerCase();
  if (/[^aeiou]ies$/.test(lower)) return `${lower.slice(0, -3)}y`;
  if (/(?:ss|sh|ch|x|zz)es$/.test(lower)) return lower.slice(0, -2);
  if (/[^s]s$/.test(lower)) return lower.slice(0, -1);
  return null;
}

/** A new bot's hello, built from its own name and role. */
export function botGreeting(name: string, role: string) {
  const hello = `Hi, I'm ${name.trim()}.`;
  const line = role.trim().replace(/[.!]+$/, '');
  if (!line) return hello;
  const [verb, ...rest] = line.split(/\s+/);
  const base = rest.length ? firstPerson(verb) : null;
  if (base) {
    // A second verb joined by "and" ("reproduces and fixes") follows the first; only "-es"
    // words convert there, since a plural noun after "and" usually ends in a bare "s".
    const words = rest.map((word, index) =>
      rest[index - 1] === 'and' && /es$/.test(word) ? (firstPerson(word) ?? word) : word,
    );
    return `${hello} I'll ${base} ${words.join(' ')}.`;
  }
  return `${hello} ${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
}

/** A random character and colour different from the current pair where possible. */
export function shuffleAppearance<S extends string, C extends string>(
  styles: readonly { id: S }[],
  colors: readonly { id: C }[],
  current: { style: string; color: string },
  random: () => number = Math.random,
): { style: S; color: C } {
  const pick = <T extends { id: string }>(items: readonly T[], avoid: string) => {
    const choices = items.length > 1 ? items.filter((item) => item.id !== avoid) : items;
    return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
  };
  return { style: pick(styles, current.style).id, color: pick(colors, current.color).id };
}

export interface NextWake {
  botId: string;
  wakeId: string;
  at: Date;
}

/**
 * Each bot's next scheduled or observed wake within `hours` of `now`, soonest first.
 * Only enabled wake-ups of existing bots count, read from the hub's own next check time.
 */
export function nextWakes(
  bots: readonly { id: string; wakes: readonly { id: string; enabled: boolean }[] }[],
  states: readonly Pick<WakeState, 'botId' | 'wakeId' | 'nextCheckAt'>[],
  now: Date,
  hours = 24,
): NextWake[] {
  const end = now.getTime() + hours * 3_600_000;
  const soonest = new Map<string, NextWake>();
  for (const state of states) {
    const bot = bots.find((item) => item.id === state.botId);
    if (!bot?.wakes.some((wake) => wake.id === state.wakeId && wake.enabled)) continue;
    if (!state.nextCheckAt) continue;
    const at = new Date(state.nextCheckAt);
    const time = at.getTime();
    if (Number.isNaN(time) || time < now.getTime() || time > end) continue;
    const current = soonest.get(bot.id);
    if (!current || time < current.at.getTime())
      soonest.set(bot.id, { botId: bot.id, wakeId: state.wakeId, at });
  }
  return [...soonest.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
}
