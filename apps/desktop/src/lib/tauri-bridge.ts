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

export async function listWorktrees(repoPath: string): Promise<WorktreeEntry[]> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<WorktreeEntry[]>('git_list_worktrees', { repoPath });
  }
  throw new Error('Open the desktop app to read worktrees.');
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

  throw new Error('Open the desktop app to create a worktree.');
}

export async function getSystemInfo(): Promise<SystemInfo> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<SystemInfo>('system_get_info');
  }

  throw new Error('Device information is available in the desktop app.');
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

  throw new Error('Open the desktop app to start a process.');
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
 * `agent-pty-exit` event. Requires the desktop runtime. */
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
  throw new Error('Open the desktop app to start a terminal.');
}

/** Writes raw bytes (e.g. a command plus a newline) to a running pty's stdin. */
export async function ptyWrite(sessionId: string, data: string): Promise<void> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('pty_write', { sessionId, data });
  }
  throw new Error('Open the desktop app to write to a terminal.');
}

/** Kills a running pty session's child process. */
export async function ptyKill(sessionId: string): Promise<void> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('pty_kill', { sessionId });
  }
  throw new Error('Open the desktop app to stop a terminal.');
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

export interface McpServerConfig {
  extra?: Record<string, unknown>;
  id: string;
  name: string;
  scope: 'global' | 'claude' | 'codex' | 'grok' | string;
  transport: 'stdio' | 'http' | 'sse' | string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  description?: string;
  enabled?: boolean;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpProbeResult {
  ok: boolean;
  tools: McpToolInfo[];
  latencyMs?: number;
  error?: string;
}

export async function listMcpServers(): Promise<McpServerConfig[]> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<McpServerConfig[]>('mcp_list_servers');
  }
  throw new Error('Open the desktop app to read MCP connections.');
}

export async function saveMcpServer(server: McpServerConfig): Promise<void> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('mcp_save_server', { server });
  }
  throw new Error('Open the desktop app to save an MCP connection.');
}

export async function deleteMcpServer(id: string, scope: string): Promise<void> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('mcp_delete_server', { id, scope });
  }
  throw new Error('Open the desktop app to delete an MCP connection.');
}

export async function probeMcpServer(server: McpServerConfig): Promise<McpProbeResult> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<McpProbeResult>('mcp_probe_server', { server });
  }
  throw new Error('Open the desktop app to test an MCP connection.');
}
