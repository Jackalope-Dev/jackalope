/** A paused dispatch: an applied integration's merge is no longer on its target branch. */
export interface DispatchPaused {
  projectPath: string;
  /** Absent in messages from versions that did not name the branch. */
  branch: string | null;
  integrationId: string;
  commit: string | null;
}

// Mirrors the message from reachable_sources in src-tauri/src/commands/integration.rs.
const PAUSED =
  /^Dispatch paused: the target branch (?:(\S+) )?in (.+?) no longer contains integration (\S+?)(?: \(commit ([0-9a-f]+)\))?\./;

export function parseDispatchPaused(error?: string | null): DispatchPaused | null {
  const match = error ? PAUSED.exec(error) : null;
  if (!match) return null;
  const [, branch, projectPath, integrationId, commit] = match;
  return { projectPath, branch: branch ?? null, integrationId, commit: commit ?? null };
}

/**
 * Every paused-dispatch message to explain: the queue view lists paused integrations,
 * and a queue error from dispatch (or an older version) may carry one too. Optionally
 * limited to one project folder.
 */
export function pausedDispatchMessages(
  paused: readonly { message: string }[] | undefined,
  error?: string | null,
  projectPath?: string,
) {
  const messages = (paused ?? []).map((entry) => entry.message);
  if (error && parseDispatchPaused(error)) messages.push(error);
  const unique = [...new Set(messages)];
  if (!projectPath) return unique;
  return unique.filter((message) => {
    const parsed = parseDispatchPaused(message);
    return parsed !== null && samePath(parsed.projectPath, projectPath);
  });
}

export const samePath = (a: string, b: string) =>
  a.replace(/[\\/]+$/, '') === b.replace(/[\\/]+$/, '');

/** The folder name, for a paused project that is not in the project list. */
export function pathLabel(path: string) {
  return (
    path
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop() ?? path
  );
}

/** Plain-language wording; the raw message stays available as details. */
export function describeDispatchPaused(paused: DispatchPaused, project: string) {
  const branch = paused.branch ? `The ${paused.branch} branch` : 'Its target branch';
  const commit = paused.commit ? ` (commit ${paused.commit})` : '';
  const fix = paused.branch
    ? ` Merge that commit back into ${paused.branch}, or reset ${paused.branch} to a commit that includes it.`
    : ' Restore that merge on the target branch.';
  return {
    title: `Dependent work in ${project} is paused`,
    body: `${branch} no longer includes a merge Jackalope made earlier${commit}, so tasks that build on it won't start.${fix}`,
  };
}

/** One sentence for several paused projects; each row then names its branch and commit. */
export function describeSeveralPaused(count: number) {
  return {
    title: `Dependent work is paused in ${count} projects`,
    body: "Each project's branch no longer includes a merge Jackalope made earlier, so tasks that build on it won't start. Merge the listed commit back into that branch, or reset the branch to a commit that includes it.",
  };
}
