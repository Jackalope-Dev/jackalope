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

const mockMcpServers: McpServerConfig[] = [
  {
    id: 'github',
    name: 'GitHub MCP',
    scope: 'global',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_••••••••••••' },
    description: 'Repository management, issues, PRs, and commit inspection.',
    enabled: true,
  },
  {
    id: 'postgres',
    name: 'PostgreSQL Server',
    scope: 'claude',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    env: { POSTGRES_URL: 'postgresql://localhost:5432/jackalope' },
    description: 'Query and inspect relational PostgreSQL databases.',
    enabled: true,
  },
  {
    id: 'memory-service',
    name: 'Local Vector Memory',
    scope: 'codex',
    transport: 'http',
    url: 'http://localhost:8765/mcp',
    description: 'Local embeddings and semantic task recall memory.',
    enabled: true,
  },
];

export async function listMcpServers(): Promise<McpServerConfig[]> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<McpServerConfig[]>('mcp_list_servers');
  }
  await new Promise((res) => setTimeout(res, 150));
  return [...mockMcpServers];
}

export async function saveMcpServer(server: McpServerConfig): Promise<void> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('mcp_save_server', { server });
  }
  await new Promise((res) => setTimeout(res, 150));
  const idx = mockMcpServers.findIndex((s) => s.id === server.id && s.scope === server.scope);
  if (idx >= 0) {
    mockMcpServers[idx] = server;
  } else {
    mockMcpServers.push(server);
  }
}

export async function deleteMcpServer(id: string, scope: string): Promise<void> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('mcp_delete_server', { id, scope });
  }
  await new Promise((res) => setTimeout(res, 150));
  const idx = mockMcpServers.findIndex((s) => s.id === id && s.scope === scope);
  if (idx >= 0) {
    mockMcpServers.splice(idx, 1);
  }
}

export async function probeMcpServer(server: McpServerConfig): Promise<McpProbeResult> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<McpProbeResult>('mcp_probe_server', { server });
  }
  await new Promise((res) => setTimeout(res, 450));
  if (server.id.includes('postgres')) {
    return {
      ok: true,
      latencyMs: 84,
      tools: [
        { name: 'query_sql', description: 'Execute read-only SQL query against the database' },
        { name: 'describe_table', description: 'Inspect schema and columns of a table' },
        { name: 'list_tables', description: 'List all public tables in the connected schema' },
      ],
    };
  }
  if (server.id.includes('github')) {
    return {
      ok: true,
      latencyMs: 120,
      tools: [
        { name: 'get_file_contents', description: 'Read file contents from a repository branch' },
        { name: 'create_or_update_file', description: 'Commit file updates directly to GitHub' },
        { name: 'list_pull_requests', description: 'List open pull requests with reviews' },
        { name: 'create_issue', description: 'Open a new issue on GitHub' },
      ],
    };
  }
  return {
    ok: true,
    latencyMs: 65,
    tools: [
      { name: `${server.id}_status`, description: `Health check and tools for ${server.name}` },
      { name: `${server.id}_exec`, description: `Execute action on ${server.name}` },
    ],
  };
}
