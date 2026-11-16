/** Where the workspace is: a view, the focused project and, in Settings, the open category. */
export interface WorkspaceLocation {
  tab: string;
  projectId: string | null;
  category?: string;
  settingsProjectId?: string;
}

/** Visited locations, oldest first, and the one showing. */
export interface NavigationHistory {
  entries: readonly WorkspaceLocation[];
  index: number;
}

const HISTORY_LIMIT = 50;

export const sameLocation = (a: WorkspaceLocation, b: WorkspaceLocation) =>
  a.tab === b.tab &&
  a.projectId === b.projectId &&
  a.category === b.category &&
  a.settingsProjectId === b.settingsProjectId;

export const startHistory = (first: WorkspaceLocation): NavigationHistory => ({
  entries: [first],
  index: 0,
});

/**
 * Records a move to `location`, dropping anything Forward led to. A location with no project
 * (before the first one loads) is replaced rather than kept as a step to go back to.
 */
export function visitLocation(
  history: NavigationHistory,
  location: WorkspaceLocation,
): NavigationHistory {
  const current = history.entries[history.index];
  if (sameLocation(current, location)) return history;
  const kept = history.entries.slice(
    0,
    current.projectId === null ? history.index : history.index + 1,
  );
  const entries = [...kept, location].slice(-HISTORY_LIMIT);
  return { entries, index: entries.length - 1 };
}

/** The history one step back (-1) or forward (1), or null at either end. */
export function stepHistory(history: NavigationHistory, delta: -1 | 1): NavigationHistory | null {
  const index = history.index + delta;
  return index < 0 || index >= history.entries.length ? null : { ...history, index };
}

/** The history with the showing entry swapped for `location`. */
export function replaceLocation(
  history: NavigationHistory,
  location: WorkspaceLocation,
): NavigationHistory {
  return {
    ...history,
    entries: history.entries.map((entry, index) => (index === history.index ? location : entry)),
  };
}
