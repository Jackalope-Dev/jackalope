import { useEffect, useRef, useState } from 'react';
import { useKeybindingHandlers } from '../../hooks/useKeybindings';
import {
  replaceLocation,
  sameLocation,
  startHistory,
  stepHistory,
  visitLocation,
  type WorkspaceLocation,
} from '../../lib/navigation-history';

/**
 * Back and Forward through the pages visited in this window. `location` is where the
 * workspace is now; `open` shows a visited location again and returns the one it could
 * reach (a removed project keeps the current one).
 */
export function useWorkspaceHistory(
  location: WorkspaceLocation,
  open: (location: WorkspaceLocation) => WorkspaceLocation,
) {
  const [history, setHistory] = useState(() => startHistory(location));
  /** The location a step is restoring, so the renders on the way there are not recorded. */
  const restoring = useRef<WorkspaceLocation | null>(null);
  const { tab, projectId, category, settingsProjectId } = location;
  useEffect(() => {
    const current = { tab, projectId, category, settingsProjectId };
    if (restoring.current) {
      if (sameLocation(restoring.current, current)) restoring.current = null;
      return;
    }
    setHistory((visited) => visitLocation(visited, current));
  }, [tab, projectId, category, settingsProjectId]);
  const go = (delta: -1 | 1) => {
    const next = stepHistory(history, delta);
    if (!next) return;
    const reached = open(next.entries[next.index]);
    if (!sameLocation(reached, location)) restoring.current = reached;
    setHistory(replaceLocation(next, reached));
  };
  const latest = useRef(go);
  latest.current = go;
  // A focused terminal keeps Alt+arrows, which shells use to move by word.
  useKeybindingHandlers({ back: () => go(-1), forward: () => go(1) });
  useEffect(() => {
    // The side buttons of a mouse: 3 is Back, 4 is Forward.
    const onMouse = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      latest.current(event.button === 3 ? -1 : 1);
    };
    window.addEventListener('mouseup', onMouse);
    return () => window.removeEventListener('mouseup', onMouse);
  }, []);
  return {
    back: history.index > 0 ? () => go(-1) : undefined,
    forward: history.index < history.entries.length - 1 ? () => go(1) : undefined,
  };
}
