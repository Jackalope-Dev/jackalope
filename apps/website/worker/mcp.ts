import type { Assets } from './markdown.ts';
import { SERVER_INFO, toolDefinitions } from './tool-definitions.ts';
import { callTool, ToolInputError } from './tools.ts';

/**
 * Stateless MCP server over Streamable HTTP (POST /api/mcp, JSON responses, no
 * sessions or server-sent events) exposing the read-only website content tools.
 */

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/** MCP Server Card (SEP-1649) for /.well-known/mcp/server-card.json. */
export function serverCard(origin: string) {
  const endpoint = `${origin}/api/mcp`;
  return {
    $schema: 'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
    name: 'dev.jackalope/website',
    title: SERVER_INFO.title,
    description:
      'Read-only access to the public content of jackalope.dev: search pages, read any page as Markdown, list help guides and read the changelog. This is the website content server, not the Jackalope desktop app or the local MCP connections it gives agents.',
    version: SERVER_INFO.version,
    websiteUrl: origin,
    serverInfo: SERVER_INFO,
    protocolVersions: PROTOCOL_VERSIONS,
    transport: { type: 'streamable-http', endpoint },
    remotes: [{ type: 'streamable-http', url: endpoint }],
    capabilities: { tools: { listChanged: false } },
    authentication: { required: false },
    tools: toolDefinitions.map(({ name, title, description }) => ({ name, title, description })),
  };
}

type JsonRpcRequest = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

const result = (id: unknown, value: unknown) => ({ jsonrpc: '2.0', id, result: value });
const error = (id: unknown, code: number, message: string) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
});

/**
 * Handles one JSON-RPC message. Returns undefined for notifications, which
 * Streamable HTTP acknowledges with 202 and no body.
 */
export async function handleMcpMessage(
  message: unknown,
  assets: Assets,
  origin: string,
): Promise<Record<string, unknown> | undefined> {
  const request = (message ?? {}) as JsonRpcRequest;
  if (
    !message ||
    typeof message !== 'object' ||
    Array.isArray(message) ||
    request.jsonrpc !== '2.0' ||
    typeof request.method !== 'string'
  )
    return error(request.id, -32600, 'Invalid JSON-RPC 2.0 request');
  if (!('id' in request)) return;
  const { id } = request;
  const params = (request.params ?? {}) as Record<string, unknown>;
  switch (request.method) {
    case 'initialize': {
      const requested = params.protocolVersion;
      return result(id, {
        protocolVersion:
          typeof requested === 'string' && PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Read-only access to the public content of jackalope.dev: search pages, read any page as Markdown, list help guides and read the changelog. This is the website content server, not the Jackalope desktop app or its local MCP connections.',
      });
    }
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, {
        tools: toolDefinitions.map((tool) => ({
          ...tool,
          annotations: {
            title: tool.title,
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        })),
      });
    case 'tools/call': {
      const name = params.name;
      const args = params.arguments ?? {};
      if (typeof name !== 'string') return error(id, -32602, '"name" must be a string');
      if (typeof args !== 'object' || Array.isArray(args))
        return error(id, -32602, '"arguments" must be an object');
      try {
        return result(id, await callTool(assets, origin, name, args as Record<string, unknown>));
      } catch (cause) {
        if (cause instanceof ToolInputError) return error(id, -32602, cause.message);
        console.error('MCP tool failed', name, cause);
        return error(id, -32603, `Tool ${name} failed`);
      }
    }
    default:
      return error(id, -32601, `Method not found: ${request.method}`);
  }
}
