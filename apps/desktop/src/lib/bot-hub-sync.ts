import { useAgentConfigStore } from '../stores/agentConfigStore.ts';
import { useBotStore } from '../stores/botStore.ts';
import { agentAccountFor, useProjectStore } from '../stores/projectStore.ts';
import { hubDirectory, observeBotHub } from './bot-hub.ts';
import { nativeTask } from './task-runtime.ts';
import { isTauriEnvironment } from './tauri-bridge.ts';

/** Waits for both stores so an early, empty directory never clears saved wake-up progress. */
function hydrated(ready: () => void) {
  const stores = [useBotStore.persist, useProjectStore.persist];
  if (stores.every((store) => store.hasHydrated())) {
    ready();
    return () => {};
  }
  let done = false;
  const check = () => {
    if (!done && stores.every((store) => store.hasHydrated())) {
      done = true;
      ready();
    }
  };
  const stops = stores.map((store) => store.onFinishHydration(check));
  return () => {
    for (const stop of stops) stop();
  };
}

/** Mirrors saved bots into the native hub and keeps its snapshot fresh while the app runs. */
export function observeBots() {
  if (!isTauriEnvironment()) return;
  let stop: (() => void) | undefined;
  let cancelled = false;
  const unhydrated = hydrated(() => {
    if (cancelled) return;
    stop = observeBotHub(
      async () => {
        const { customAgents } = useAgentConfigStore.getState();
        const bots = hubDirectory(
          useBotStore.getState().bots,
          useProjectStore.getState().projects,
          (bot, project) =>
            agentAccountFor(
              useProjectStore.getState().projects.find((item) => item.id === project.id),
              customAgents.find((agent) => agent.id === bot.agent)?.adapter ?? bot.agent,
            ),
        );
        await nativeTask('bot_hub_sync', { bots });
      },
      (changed) => {
        const bots = useBotStore.subscribe((state, previous) => {
          if (state.bots !== previous.bots) changed();
        });
        const projects = useProjectStore.subscribe((state, previous) => {
          if (state.projects !== previous.projects) changed();
        });
        return () => {
          bots();
          projects();
        };
      },
    );
  });
  return () => {
    cancelled = true;
    unhydrated();
    stop?.();
  };
}
