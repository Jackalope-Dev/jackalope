import { create } from 'zustand';
import type { Bot, BotWake } from '../stores/botStore.ts';
import { observeRefresh } from './observe-refresh.ts';
import { parseScheduleTiming } from './schedules.ts';
import type { RunRequest } from './task-runtime.ts';

/** A card a bot showed the person: a decision, a request for input, an action, sources or an update. */
export interface BotCard {
  id: string;
  botId: string;
  botName: string;
  sessionId: string;
  runId: string;
  kind: 'decision' | 'input' | 'action' | 'sources' | 'update';
  title: string;
  body: string;
  options: { label: string; reply?: string }[];
  sources: { title: string; url?: string; path?: string }[];
  allowText: boolean;
  status: 'open' | 'answered' | 'dismissed';
  answer: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface BotProposal {
  id: string;
  fromBotId: string;
  fromBotName: string;
  sessionId: string;
  name: string;
  role: string;
  instructions: string;
  reason: string;
  wake: { name: string; prompt: string; expression: string } | null;
  status: 'open' | 'accepted' | 'dismissed';
  createdBotId: string | null;
  createdAt: string;
}

export interface HubEvent {
  id: string;
  at: string;
  kind: 'wake' | 'skipped' | 'message' | 'reply' | 'card' | 'answer' | 'proposal' | 'created';
  botId: string;
  otherBotId: string | null;
  sessionId: string | null;
  text: string;
}

/** A note a bot saved for its future conversations. */
export interface BotNote {
  id: string;
  botId: string;
  text: string;
  sessionId: string | null;
  updatedAt: string;
}

export interface WakeState {
  wakeId: string;
  botId: string;
  nextCheckAt: string | null;
  lastCheckedAt: string | null;
  lastFiredAt: string | null;
  lastOutcome: string | null;
  lastSessionId: string | null;
}

export interface HubSnapshot {
  cards: BotCard[];
  proposals: BotProposal[];
  events: HubEvent[];
  wakes: WakeState[];
  relays: { id: string; fromBotId: string; toBotId: string; toSessionId: string }[];
  notes: BotNote[];
  /** Every scheduled and observed wake-up is paused; Run now still works. */
  paused: boolean;
  error: string | null;
}

/** The minimal project fields a bot's run request needs. */
export interface BotProject {
  id: string;
  name: string;
  path: string;
  gitBranch?: string;
  preferences?: {
    baseBranch?: string;
    verifyCommand?: string;
    prepareCommand?: string;
    setupFiles?: string[];
    autoVerify?: boolean;
  };
}

/**
 * Builds the run request a bot's conversation or routine starts with. Conversations
 * skip workspace preparation and automatic checks so a quick question answers quickly;
 * the agent can still run the saved check itself. Routines prepare and verify as tasks do.
 */
export function botRequest(
  bot: Pick<Bot, 'agent' | 'model' | 'connectionIds'>,
  project: BotProject,
  id: string,
  prompt: string,
  conversation: boolean,
  profileId?: string,
): RunRequest {
  return {
    id,
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path,
    agent: bot.agent,
    model: bot.agent === 'auto' ? undefined : bot.model?.id,
    agentProfileId: bot.agent === 'auto' ? undefined : profileId,
    connectionIds: bot.connectionIds ?? undefined,
    prompt,
    isolated: true,
    targetBranch: project.preferences?.baseBranch || project.gitBranch,
    verifyCommand: project.preferences?.verifyCommand,
    prepareCommand: conversation ? undefined : project.preferences?.prepareCommand,
    setupFiles: project.preferences?.setupFiles,
    autoVerify: conversation ? false : (project.preferences?.autoVerify ?? true),
  };
}

/** Cards and suggestions that wait on the person, optionally for one bot. */
export function needsYou(snapshot: Pick<HubSnapshot, 'cards' | 'proposals'>, botId?: string) {
  const cards = snapshot.cards.filter(
    (card) =>
      card.status === 'open' &&
      (card.options.length > 0 || card.allowText) &&
      (!botId || card.botId === botId),
  );
  const proposals = snapshot.proposals.filter(
    (proposal) => proposal.status === 'open' && (!botId || proposal.fromBotId === botId),
  );
  return { cards, proposals, count: cards.length + proposals.length };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** One line saying what wakes a bot, for lists and activity. */
export function describeWake(wake: BotWake, connectionName?: string) {
  const trigger = wake.trigger;
  if (trigger.kind === 'repoChange')
    return trigger.path ? `When ${trigger.path} changes` : 'When the project changes';
  if (trigger.kind === 'connection') {
    const every =
      trigger.intervalMinutes % 60 === 0
        ? `${trigger.intervalMinutes / 60} h`
        : `${trigger.intervalMinutes} min`;
    return `When ${trigger.tool} on ${connectionName ?? trigger.connectionId} returns new data · checked every ${every}`;
  }
  const timing = parseScheduleTiming(trigger.expression);
  if (!timing) return `On schedule ${trigger.expression}`;
  if (timing.repeat === 'hourly')
    return timing.hours === '1' ? 'Every hour' : `Every ${timing.hours} hours`;
  if (timing.repeat === 'daily') return `Every day at ${timing.time}`;
  if (timing.repeat === 'weekdays') return `Weekdays at ${timing.time}`;
  return `${WEEKDAYS[Number(timing.weekday)]}s at ${timing.time}`;
}

/** The payload native wake-ups and bot tools read: bots whose project is still available. */
export function hubDirectory(
  bots: Bot[],
  projects: BotProject[],
  profileId: (bot: Bot, project: BotProject) => string | undefined,
) {
  return bots.flatMap((bot) => {
    const project = projects.find((item) => item.id === bot.projectId);
    if (!project) return [];
    return [
      {
        id: bot.id,
        name: bot.name,
        role: bot.role,
        instructions: bot.instructions,
        collaborate: bot.collaborate,
        wakes: bot.wakes,
        request: botRequest(bot, project, bot.id, 'Bot', true, profileId(bot, project)),
      },
    ];
  });
}

const EMPTY: HubSnapshot = {
  cards: [],
  proposals: [],
  events: [],
  wakes: [],
  relays: [],
  notes: [],
  paused: false,
  error: null,
};

interface HubState extends HubSnapshot {
  loaded: boolean;
  refresh: () => Promise<void>;
}

async function invoke<T>(command: string, args?: Record<string, unknown>) {
  const { nativeTask } = await import('./task-runtime.ts');
  return nativeTask<T>(command, args);
}

export const useBotHubStore = create<HubState>((set) => ({
  ...EMPTY,
  loaded: false,
  refresh: async () => {
    try {
      set({ ...(await invoke<HubSnapshot>('bot_hub_snapshot')), loaded: true });
    } catch (error) {
      set({ error: String(error), loaded: true });
    }
  },
}));

export const answerCard = async (id: string, option?: number, text?: string) => {
  await invoke('bot_hub_card', { id, action: 'answer', option, text });
  await useBotHubStore.getState().refresh();
};
export const dismissCard = async (id: string) => {
  await invoke('bot_hub_card', { id, action: 'dismiss' });
  await useBotHubStore.getState().refresh();
};
export const resolveProposal = async (id: string, action: 'accept' | 'dismiss', botId?: string) => {
  await invoke('bot_hub_proposal', { id, action, botId });
  await useBotHubStore.getState().refresh();
};
/** Failures surface in the hub error so menu actions never fail silently. */
export const setWakeUpsPaused = async (paused: boolean) => {
  try {
    await invoke('bot_hub_pause', { paused });
    await useBotHubStore.getState().refresh();
  } catch (error) {
    useBotHubStore.setState({
      error: `Wake-ups could not be ${paused ? 'paused' : 'resumed'}: ${error}`,
    });
  }
};
export const forgetNote = async (id: string) => {
  await invoke('bot_hub_forget_note', { id });
  await useBotHubStore.getState().refresh();
};
export const wakeNow = (botId: string, wakeId: string) =>
  invoke<string>('bot_hub_wake_now', { botId, wakeId });
export const connectionTools = (projectId: string, connectionId: string) =>
  invoke<{ name: string; description?: string }[]>('bot_hub_connection_tools', {
    projectId,
    connectionId,
  });

/** Keeps native wake-ups in step with saved bots and the hub snapshot fresh. Returns a cleanup. */
export function observeBotHub(
  sync: () => Promise<void>,
  watch: (changed: () => void) => () => void,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let syncing = Promise.resolve();
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      syncing = syncing.then(sync).catch((error) => {
        useBotHubStore.setState({ error: `Bot wake-ups could not be updated: ${error}` });
      });
    }, 400);
  };
  schedule();
  const unwatch = watch(schedule);
  const stop = observeRefresh({
    refresh: () => useBotHubStore.getState().refresh(),
    interval: () => (document.hidden ? 60_000 : 15_000),
    subscribe: async (changed) => {
      const { listen } = await import('@tauri-apps/api/event');
      return listen('bot-hub-changed', changed);
    },
  });
  return () => {
    clearTimeout(timer);
    unwatch();
    stop();
  };
}
