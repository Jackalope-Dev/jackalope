/**
 * Where new work in a Git project runs: an isolated worktree, a new branch in
 * the project checkout, the checkout's current branch, or a choice made when
 * each task starts.
 */
export type WorkspaceMode = 'worktree' | 'branch' | 'current' | 'ask';

export const WORKSPACE_MODES: WorkspaceMode[] = ['worktree', 'branch', 'current', 'ask'];

interface WorkspacePreferences {
  preferences?: { workspaceMode?: WorkspaceMode; isolatedByDefault?: boolean };
}

export function workspaceModeFor(project: WorkspacePreferences | undefined): WorkspaceMode {
  const preferences = project?.preferences;
  return (
    preferences?.workspaceMode ??
    (preferences?.isolatedByDefault === false ? 'current' : 'worktree')
  );
}

/**
 * The workspace fields of a task request. `isolated` is the composer's choice;
 * choosing to edit files follows the project's in-place mode.
 */
export function workspaceRequest(
  project: WorkspacePreferences | undefined,
  isolated: boolean = workspaceModeFor(project) === 'worktree',
): { isolated: boolean; workspaceMode: WorkspaceMode } {
  if (isolated) return { isolated: true, workspaceMode: 'worktree' };
  const mode = workspaceModeFor(project);
  return { isolated: false, workspaceMode: mode === 'worktree' ? 'current' : mode };
}
