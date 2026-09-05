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
const mockWorktrees: WorktreeEntry[] = [
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

// --- Native PTY terminal streaming (see src-tauri/src/commands/pty.rs) ---

export interface PtySpawnOptions {
  program: string;
  args: string[];
  workingDir: string;
  cols?: number;
  rows?: number;
}

export interface PtyOutputPayload {
  session_id: string;
  chunk: string;
}

export interface PtyExitPayload {
  session_id: string;
  exit_code: number | null;
}

/** Opens a real OS pty and spawns `program` on it. Returns a session id used
 * by `ptyWrite`/`ptyKill` and present on every matching `agent-pty-output`/
 * `agent-pty-exit` event. Browser dev-mode returns a mock id and no process
 * is actually spawned — callers should treat that mode's output as inert. */
export async function ptySpawn(opts: PtySpawnOptions): Promise<string> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('pty_spawn', {
      program: opts.program,
      args: opts.args,
      workingDir: opts.workingDir,
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
    });
  }
  return `mock-${opts.program}-${Date.now()}`;
}

/** Writes raw bytes (e.g. a command plus a newline) to a running pty's stdin. */
export async function ptyWrite(sessionId: string, data: string): Promise<void> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('pty_write', { sessionId, data });
  }
}

/** Kills a running pty session's child process. */
export async function ptyKill(sessionId: string): Promise<void> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('pty_kill', { sessionId });
  }
}

/** Subscribes to streamed pty output across *all* sessions — filter by
 * `payload.session_id` in the callback. Returns an unsubscribe function;
 * no-ops (and never fires) outside a Tauri runtime. */
export async function listenPtyOutput(
  callback: (payload: PtyOutputPayload) => void,
): Promise<() => void> {
  if (isTauriEnvironment()) {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<PtyOutputPayload>('agent-pty-output', (event) => callback(event.payload));
  }
  return () => {};
}

/** Subscribes to pty session-exit notifications across all sessions. */
export async function listenPtyExit(
  callback: (payload: PtyExitPayload) => void,
): Promise<() => void> {
  if (isTauriEnvironment()) {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<PtyExitPayload>('agent-pty-exit', (event) => callback(event.payload));
  }
  return () => {};
}
