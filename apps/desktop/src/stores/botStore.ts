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
  /** Native schedule IDs created as this bot's routines. */
  routineIds: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export type BotDraft = Omit<Bot, 'id' | 'routineIds' | 'pinned' | 'createdAt' | 'updatedAt'>;

export const BOT_NAME_MAX = 60;
export const BOT_INSTRUCTIONS_MAX = 6000;

export function validateBot(draft: BotDraft) {
  const name = draft.name.trim();
  if (!name) return 'Give the bot a name.';
  if ([...name].length > BOT_NAME_MAX) return `Keep the name under ${BOT_NAME_MAX} characters.`;
  if (!draft.projectId) return 'Choose the project this bot works in.';
  if (new TextEncoder().encode(draft.instructions.trim()).length > BOT_INSTRUCTIONS_MAX)
    return 'Shorten the instructions to under 6,000 bytes.';
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
  addRoutine: (id: string, scheduleId: string) => void;
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
      addRoutine: (id, scheduleId) =>
        set((state) => ({
          bots: state.bots.map((bot) =>
            bot.id === id ? { ...bot, routineIds: [...bot.routineIds, scheduleId] } : bot,
          ),
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
      version: 1,
      storage: createPersistStorage(),
      partialize: (state) => ({ bots: state.bots, selectedId: state.selectedId }),
    },
  ),
);

/** Pinned bots first, then most recently changed. */
export function rosterOrder(bots: Bot[]) {
  return [...bots].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
  );
}

/** The standing instructions a routine's scheduled task receives. */
export function routinePrompt(bot: Pick<Bot, 'name' | 'instructions'>, task: string) {
  const standing = bot.instructions.trim()
    ? `Standing instructions:\n${bot.instructions.trim()}\n\n`
    : '';
  return `You are ${bot.name}, a saved Jackalope bot running a scheduled routine.\n${standing}Routine:\n${task.trim()}`;
}
