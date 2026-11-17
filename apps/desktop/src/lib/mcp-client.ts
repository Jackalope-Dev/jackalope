import { invokeNative } from './native/transport.ts';

export interface McpServerConfig {
  managed?: boolean;
  agents?: string[] | null;
  discovery?: boolean;
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

interface McpToolInfo {
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

export const listMcpServers = (projectId?: string) =>
  invokeNative<McpServerConfig[]>('mcp_list_servers', { projectId });

export const saveMcpServer = (server: McpServerConfig) =>
  invokeNative<void>('mcp_save_server', { server });

export const deleteMcpServer = (id: string, scope: string) =>
  invokeNative<void>('mcp_delete_server', { id, scope });

export const probeMcpServer = (server: McpServerConfig) =>
  invokeNative<McpProbeResult>('mcp_probe_server', { server });
