export interface WorktreeEntry {
  path: string;
  head: string;
  branch: string;
  is_bare: boolean;
  is_locked: boolean;
}

export interface SystemInfo {
  os: string;
  arch: string;
  device_name: string;
  git_available: boolean;
}

export interface AgentProcessResult {
  pid: number;
  status: string;
  message: string;
}

export const isTauriEnvironment = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

// Fallback mock state for browser dev mode
let mockWorktrees: WorktreeEntry[] = [
  {
    path: '.worktrees/feat-auto-prompt',
    head: '7fa4b12',
    branch: 'feat/auto-prompt-refiner',
    is_bare: false,
    is_locked: false,
  },
  {
    path: '.worktrees/fix-memory-profile',
    head: 'c3e2991',
    branch: 'fix/memory-leak-ptys',
    is_bare: false,
    is_locked: false,
  },
];

export async function listWorktrees(repoPath: string): Promise<WorktreeEntry[]> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<WorktreeEntry[]>('git_list_worktrees', { repoPath });
  }
  // Browser preview mode
  await new Promise((res) => setTimeout(res, 200));
  return [...mockWorktrees];
}

export async function createWorktree(
  repoPath: string,
  worktreePath: string,
  branchName: string,
  baseCommit?: string,
): Promise<WorktreeEntry> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<WorktreeEntry>('git_create_worktree', {
      repoPath,
      worktreePath,
      branchName,
      baseCommit,
    });
  }

  // Browser preview mode
  await new Promise((res) => setTimeout(res, 350));
  const newEntry: WorktreeEntry = {
    path: worktreePath,
    head: baseCommit || 'HEAD',
    branch: branchName,
    is_bare: false,
    is_locked: false,
  };
  mockWorktrees.push(newEntry);
  return newEntry;
}

export async function getSystemInfo(): Promise<SystemInfo> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<SystemInfo>('system_get_info');
  }

  return {
    os: 'windows',
    arch: 'x86_64',
    device_name: 'DEV-WORKSTATION',
    git_available: true,
  };
}

export async function spawnAgentProcess(
  program: string,
  args: string[],
  workingDir: string,
): Promise<AgentProcessResult> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<AgentProcessResult>('agent_spawn_process', {
      program,
      args,
      workingDir,
    });
  }

  await new Promise((res) => setTimeout(res, 300));
  return {
    pid: Math.floor(1000 + Math.random() * 9000),
    status: 'running',
    message: `Spawned ${program} (browser simulation) in ${workingDir}`,
  };
}
