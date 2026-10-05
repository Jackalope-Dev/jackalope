import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createPersistStorage } from '../lib/persist-storage.ts';

/**
 * A saved, long-lived agent: a name and standing instructions plus the agent,
 * model, project and connections its conversations start with. Conversations
 * carry the persona natively, so they keep the bot's role after edits here.
 */
export interface Bot {
  id: string;
  name: string;
  /** Short line shown in the roster. */
  role: string;
  instructions: string;
  /** 'auto' lets Jackalope route each conversation. */
  agent: string;
  model: { id: string; name: string } | null;
  projectId: string;
  /** null delivers every enabled connection; a list limits new conversations to those IDs. */
  connectionIds: string[] | null;
  /** Native schedule IDs created as routines before wake-ups existed; still listed and toggled. */
  routineIds: string[];
  /** What starts a conversation without the person: schedules, repository or connection changes. */
  wakes: BotWake[];
  /** Whether the bot may message other bots and accept their messages. */
  collaborate: boolean;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  /** Chosen look; bots saved before this existed draw their agent's character in the text colour. */
  appearance?: BotAppearance;
}

/** Character silhouettes a bot can wear, shared with the agent characters. */
export const BOT_STYLES = [
  { id: 'codex', name: 'Antlers' },
  { id: 'claude', name: 'Starburst' },
  { id: 'grok', name: 'Orbit' },
  { id: 'antigravity', name: 'Peak' },
  { id: 'opencode', name: 'Octagon' },
  { id: 'moon', name: 'Moon' },
  { id: 'blob', name: 'Blob' },
  { id: 'heart', name: 'Heart' },
  { id: 'cloud', name: 'Cloud' },
  { id: 'ghost', name: 'Ghost' },
  { id: 'cat', name: 'Cat' },
  { id: 'gem', name: 'Gem' },
  { id: 'shield', name: 'Shield' },
  { id: 'sprout', name: 'Sprout' },
] as const;

/** Saturated mid-tones that keep the character's surface-coloured eyes visible in both themes. */
export const BOT_COLORS = [
  { id: 'ink', name: 'Ink', value: 'var(--color-text-primary)' },
  { id: 'accent', name: 'Theme', value: 'var(--color-accent)' },
  { id: 'coral', name: 'Coral', value: '#f2665c' },
  { id: 'amber', name: 'Amber', value: '#e9a23b' },
  { id: 'green', name: 'Green', value: '#2fb37f' },
  { id: 'teal', name: 'Teal', value: '#1fa7bd' },
  { id: 'blue', name: 'Blue', value: '#4c86f0' },
  { id: 'violet', name: 'Violet', value: '#8b6cf6' },
  { id: 'pink', name: 'Pink', value: '#e05297' },
] as const;

export interface BotAppearance {
  style: (typeof BOT_STYLES)[number]['id'];
  color: (typeof BOT_COLORS)[number]['id'];
}

export type BotWakeTrigger =
  | { kind: 'schedule'; expression: string; timezone: string }
  | { kind: 'repoChange'; path: string }
  | {
      kind: 'connection';
      connectionId: string;
      tool: string;
      arguments: Record<string, unknown>;
      intervalMinutes: number;
    };

export interface BotWake {
  id: string;
  name: string;
  /** What the bot should do when this wakes it. */
  prompt: string;
  enabled: boolean;
  trigger: BotWakeTrigger;
}

export type BotDraft = Omit<Bot, 'id' | 'routineIds' | 'pinned' | 'createdAt' | 'updatedAt'>;

export const BOT_NAME_MAX = 60;
export const BOT_INSTRUCTIONS_MAX = 6000;
export const BOT_WAKES_MAX = 10;
export const WAKE_PROMPT_MAX = 4000;

/** Mirrors native wake-up validation so problems show in the editor before saving. */
export function validateWake(wake: BotWake, connectionIds: string[] | null) {
  const name = wake.name.trim();
  if (!name || [...name].length > 80) return 'Name each wake-up in up to 80 characters.';
  const prompt = wake.prompt.trim();
  if (!prompt || [...prompt].length > WAKE_PROMPT_MAX)
    return `Describe what “${name}” should do in up to ${WAKE_PROMPT_MAX.toLocaleString()} characters.`;
  const trigger = wake.trigger;
  if (trigger.kind === 'schedule' && trigger.expression.trim().split(/\s+/).length !== 5)
    return `Choose when “${name}” runs.`;
  if (
    trigger.kind === 'repoChange' &&
    (/[\\:]/.test(trigger.path) ||
      trigger.path.startsWith('/') ||
      trigger.path.split('/').some((part) => part === '..' || part === '.'))
  )
    return 'Watch a path relative to the project, using forward slashes.';
  if (trigger.kind === 'connection') {
    if (!trigger.connectionId || !trigger.tool.trim())
      return `Choose a connection and tool for “${name}”.`;
    if (trigger.intervalMinutes < 5 || trigger.intervalMinutes > 1440)
      return 'Check connections every 5 minutes to once a day.';
    if (connectionIds && !connectionIds.includes(trigger.connectionId))
      return `This bot cannot use the connection “${name}” watches.`;
  }
  return '';
}

export function validateBot(draft: BotDraft) {
  const name = draft.name.trim();
  if (!name) return 'Give the bot a name.';
  if ([...name].length > BOT_NAME_MAX) return `Keep the name under ${BOT_NAME_MAX} characters.`;
  if (!draft.projectId) return 'Choose the project this bot works in.';
  if ([...draft.instructions.trim()].length > BOT_INSTRUCTIONS_MAX)
    return `Shorten the instructions to under ${BOT_INSTRUCTIONS_MAX.toLocaleString()} characters.`;
  if (draft.wakes.length > BOT_WAKES_MAX) return `Keep at most ${BOT_WAKES_MAX} wake-ups per bot.`;
  for (const wake of draft.wakes) {
    const error = validateWake(wake, draft.connectionIds);
    if (error) return error;
  }
  return '';
}

interface BotState {
  bots: Bot[];
  selectedId: string | null;
  select: (id: string | null) => void;
  create: (draft: BotDraft) => string;
  update: (id: string, patch: Partial<BotDraft>) => void;
  duplicate: (id: string) => string | null;
  remove: (id: string) => void;
  togglePin: (id: string) => void;
  forgetRoutine: (scheduleId: string) => void;
}

export const useBotStore = create<BotState>()(
  persist(
    (set, get) => ({
      bots: [],
      selectedId: null,
      select: (selectedId) => set({ selectedId }),
      create: (draft) => {
        const error = validateBot(draft);
        if (error) throw new Error(error);
        const now = new Date().toISOString();
        const bot: Bot = {
          ...draft,
          name: draft.name.trim(),
          role: draft.role.trim(),
          instructions: draft.instructions.trim(),
          id: crypto.randomUUID(),
          routineIds: [],
          pinned: false,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ bots: [...state.bots, bot], selectedId: bot.id }));
        return bot.id;
      },
      update: (id, patch) => {
        const current = get().bots.find((bot) => bot.id === id);
        if (!current) throw new Error('This bot no longer exists.');
        const next = { ...current, ...patch };
        const error = validateBot(next);
        if (error) throw new Error(error);
        set((state) => ({
          bots: state.bots.map((bot) =>
            bot.id === id
              ? {
                  ...next,
                  name: next.name.trim(),
                  role: next.role.trim(),
                  instructions: next.instructions.trim(),
                  updatedAt: new Date().toISOString(),
                }
              : bot,
          ),
        }));
      },
      duplicate: (id) => {
        const source = get().bots.find((bot) => bot.id === id);
        if (!source) return null;
        const suffix = ' copy';
        return get().create({
          name: `${source.name.slice(0, BOT_NAME_MAX - suffix.length)}${suffix}`,
          role: source.role,
          instructions: source.instructions,
          agent: source.agent,
          model: source.model,
          projectId: source.projectId,
          connectionIds: source.connectionIds,
          appearance: source.appearance,
          collaborate: source.collaborate,
          // Copies start quiet so two bots never wake for the same trigger by surprise.
          wakes: source.wakes.map((wake) => ({ ...wake, id: crypto.randomUUID(), enabled: false })),
        });
      },
      remove: (id) =>
        set((state) => ({
          bots: state.bots.filter((bot) => bot.id !== id),
          selectedId: state.selectedId === id ? null : state.selectedId,
        })),
      togglePin: (id) =>
        set((state) => ({
          bots: state.bots.map((bot) => (bot.id === id ? { ...bot, pinned: !bot.pinned } : bot)),
        })),
      forgetRoutine: (scheduleId) =>
        set((state) => ({
          bots: state.bots.map((bot) => ({
            ...bot,
            routineIds: bot.routineIds.filter((item) => item !== scheduleId),
          })),
        })),
    }),
    {
      name: 'jackalope-bots-v1',
      version: 2,
      storage: createPersistStorage(),
      partialize: (state) => ({ bots: state.bots, selectedId: state.selectedId }),
      migrate: (persisted) => migrateBots(persisted),
    },
  ),
);

/** Bots saved before wake-ups and teamwork existed start with none and may collaborate. */
export function migrateBots(persisted: unknown) {
  const state = (persisted ?? {}) as { bots?: Partial<Bot>[]; selectedId?: string | null };
  return {
    selectedId: state.selectedId ?? null,
    bots: (state.bots ?? []).map(
      (bot) => ({ ...bot, wakes: bot.wakes ?? [], collaborate: bot.collaborate ?? true }) as Bot,
    ),
  } as BotState;
}

/** Pinned bots first, then most recently changed. */
export function rosterOrder(bots: Bot[]) {
  return [...bots].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
  );
}
