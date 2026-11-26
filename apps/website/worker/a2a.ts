import type { Assets } from './markdown.ts';
import { LIMITS, SERVER_INFO, toolDefinitions } from './tool-definitions.ts';
import { callTool, isTool, ToolInputError } from './tools.ts';

/**
 * Agent2Agent (https://a2a-protocol.org) JSON-RPC agent at /api/a2a over the
 * same read-only tools as /api/mcp. A message names a skill with a data part
 * {"skill": "<id>", "arguments": {...}}; plain text is routed by keyword, with
 * no language model. Speaks A2A 1.0 and 0.3, chosen by the A2A-Version header.
 * Every answer is a single Message, so no tasks are kept.
 */

type Version = '1.0' | '0.3';

/** The public Agent Card (A2A 1.0), one skill per tool. */
export function agentCard(origin: string) {
  const endpoint = `${origin}/api/a2a`;
  return {
    name: 'Jackalope website',
    description:
      'Read-only agent for the public content of jackalope.dev: search pages, read a page as Markdown, list help guides and read the changelog. It answers from the website only; it is not the Jackalope desktop app and cannot run tasks. Send a data part {"skill": "<skill id>", "arguments": {...}}, or plain text: a page path or URL reads that page, words like "changelog" or "what\'s new" list recent changes, "guides" lists help guides, and anything else searches the site.',
    version: SERVER_INFO.version,
    provider: { organization: 'Jackalope Digital LLC', url: origin },
    documentationUrl: `${origin}/.well-known/agent-skills/jackalope-website/SKILL.md`,
    iconUrl: `${origin}/icon-256.png`,
    supportedInterfaces: [
      { url: endpoint, protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
      { url: endpoint, protocolBinding: 'JSONRPC', protocolVersion: '0.3' },
    ],
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: toolDefinitions.map((tool) => ({
      id: tool.name,
      name: tool.title,
      description: `${tool.description} Arguments follow this tool's inputSchema at ${origin}/api/mcp (tools/list).`,
      tags: ['jackalope', 'website', 'read-only'],
      inputModes: ['application/json', 'text/plain'],
      outputModes: ['text/plain', 'application/json'],
    })),
  };
}

/** An empty A2A-Version means 0.3; a PascalCase method without the header is clearly 1.0. */
function negotiateVersion(header: string | null, method: unknown): Version | null {
  const value = (header || '').trim();
  if (!value) return typeof method === 'string' && /^[A-Z]/.test(method) ? '1.0' : '0.3';
  const majorMinor = value.split('.').slice(0, 2).join('.');
  if (majorMinor === '1.0' || majorMinor === '1') return '1.0';
  if (majorMinor === '0.3') return '0.3';
  return null;
}

const ERR = {
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  taskNotFound: -32001,
  pushNotSupported: -32003,
  unsupported: -32004,
  extendedCardNotConfigured: -32007,
  versionNotSupported: -32009,
} as const;

const METHODS: Record<Version, Record<string, string>> = {
  '1.0': {
    SendMessage: 'send',
    SendStreamingMessage: 'stream',
    GetTask: 'task',
    CancelTask: 'task',
    SubscribeToTask: 'task',
    ListTasks: 'list',
    CreateTaskPushNotificationConfig: 'push',
    GetTaskPushNotificationConfig: 'push',
    ListTaskPushNotificationConfigs: 'push',
    DeleteTaskPushNotificationConfig: 'push',
    GetExtendedAgentCard: 'extended',
  },
  '0.3': {
    'message/send': 'send',
    'message/stream': 'stream',
    'tasks/get': 'task',
    'tasks/cancel': 'task',
    'tasks/resubscribe': 'task',
    'tasks/pushNotificationConfig/set': 'push',
    'tasks/pushNotificationConfig/get': 'push',
    'tasks/pushNotificationConfig/list': 'push',
    'tasks/pushNotificationConfig/delete': 'push',
    'agent/getAuthenticatedExtendedCard': 'extended',
  },
};

/** Keyword routing for plain-text messages. */
export function routeText(text: string, origin: string) {
  const host = new URL(origin).host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const path =
    text.match(new RegExp(`https?://${host}(/[^\\s]*)?`))?.[1] ??
    text.match(/(?:^|\s)(\/[a-z0-9][a-z0-9/_-]*)/i)?.[1];
  if (path || text.match(new RegExp(`https?://${host}`)))
    return { name: 'read_page', args: { path: path || '/' } };
  if (
    /\b(changelog|release notes?|releases?|what(?:'?s| is) new|new features|latest changes|recent changes|updates?)\b/i.test(
      text,
    )
  )
    return { name: 'latest_changes', args: {} };
  if (/\b(list|all|which|what)\b.*\bguides?\b|^\s*guides?\s*$/i.test(text))
    return { name: 'list_guides', args: {} };
  return { name: 'search_pages', args: { query: text.slice(0, LIMITS.queryChars) } };
}

type Part = Record<string, unknown>;

/** Picks the skill and arguments out of an A2A message. */
function messageToToolCall(
  message: unknown,
  origin: string,
): { name: string; args: Record<string, unknown> } | { error: string } {
  const m = (message ?? {}) as { parts?: unknown; metadata?: unknown };
  if (!Array.isArray(m.parts) || m.parts.length === 0)
    return { error: 'message.parts must be a non-empty array' };
  const parts = m.parts as Part[];
  const meta = (m.metadata ?? {}) as Record<string, unknown>;
  const data = parts
    .map((part) => part.data)
    .find((value): value is Record<string, unknown> =>
      Boolean(value && typeof value === 'object' && !Array.isArray(value)),
    );
  const text = parts
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('\n')
    .trim();
  const named =
    (typeof data?.skill === 'string' && data.skill) ||
    (typeof data?.tool === 'string' && data.tool) ||
    (typeof meta.skill === 'string' && meta.skill) ||
    null;
  if (named) {
    const args =
      data?.arguments && typeof data.arguments === 'object' && !Array.isArray(data.arguments)
        ? (data.arguments as Record<string, unknown>)
        : Object.fromEntries(
            Object.entries(data ?? {}).filter(([key]) => key !== 'skill' && key !== 'tool'),
          );
    return { name: named, args };
  }
  if (text) return routeText(text, origin);
  return {
    error:
      'Send a data part {"skill": "<skill id>", "arguments": {...}} or a text part with a question.',
  };
}

function agentMessage(
  version: Version,
  options: { text: string; data?: unknown; contextId: string; metadata: Record<string, unknown> },
) {
  if (version === '1.0')
    return {
      message: {
        messageId: crypto.randomUUID(),
        contextId: options.contextId,
        role: 'ROLE_AGENT',
        parts: [
          { text: options.text, mediaType: 'text/markdown' },
          ...(options.data !== undefined
            ? [{ data: options.data, mediaType: 'application/json' }]
            : []),
        ],
        metadata: options.metadata,
      },
    };
  return {
    kind: 'message',
    messageId: crypto.randomUUID(),
    contextId: options.contextId,
    role: 'agent',
    parts: [
      { kind: 'text', text: options.text },
      ...(options.data !== undefined ? [{ kind: 'data', data: options.data }] : []),
    ],
    metadata: options.metadata,
  };
}

/** Handles one A2A JSON-RPC request body; the answer is always a JSON-RPC object. */
export async function handleA2aRequest(
  body: unknown,
  versionHeader: string | null,
  assets: Assets,
  origin: string,
): Promise<Record<string, unknown>> {
  const request = (body ?? {}) as {
    jsonrpc?: unknown;
    id?: unknown;
    method?: unknown;
    params?: unknown;
  };
  const id = request.id ?? null;
  const fail = (code: number, message: string, data?: unknown) => ({
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  });
  const ok = (value: unknown) => ({ jsonrpc: '2.0', id, result: value });
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string')
    return fail(ERR.invalidRequest, 'Invalid JSON-RPC 2.0 request');
  const version = negotiateVersion(versionHeader, request.method);
  if (!version)
    return fail(ERR.versionNotSupported, `A2A-Version ${versionHeader} is not supported`, {
      supportedVersions: ['1.0', '0.3'],
    });
  switch (METHODS[version][request.method]) {
    case undefined:
      return fail(ERR.methodNotFound, `Method not found: ${request.method}`);
    case 'stream':
      return fail(
        ERR.unsupported,
        'Streaming is not supported; every skill answers in one response.',
      );
    case 'task':
      return fail(
        ERR.taskNotFound,
        'Task not found: this agent answers directly and keeps no tasks.',
      );
    case 'push':
      return fail(ERR.pushNotSupported, 'Push notifications are not supported.');
    case 'extended':
      return fail(ERR.extendedCardNotConfigured, 'There is no extended agent card.');
    case 'list':
      return ok({ tasks: [], nextPageToken: '', pageSize: 0, totalSize: 0 });
  }
  const params = (request.params ?? {}) as { message?: Record<string, unknown> };
  const call = messageToToolCall(params.message, origin);
  if ('error' in call) return fail(ERR.invalidParams, call.error);
  if (!isTool(call.name))
    return fail(ERR.invalidParams, `Unknown skill "${call.name}"`, {
      skills: toolDefinitions.map((tool) => tool.name),
    });
  const contextId =
    typeof params.message?.contextId === 'string' ? params.message.contextId : crypto.randomUUID();
  try {
    const outcome = await callTool(assets, origin, call.name, call.args);
    return ok(
      agentMessage(version, {
        text: outcome.content.map((part) => part.text).join('\n\n') || '(no output)',
        data: outcome.structuredContent,
        contextId,
        metadata: { skill: call.name, ...(outcome.isError ? { isError: true } : {}) },
      }),
    );
  } catch (cause) {
    if (cause instanceof ToolInputError) return fail(ERR.invalidParams, cause.message);
    console.error('A2A skill failed', call.name, cause);
    return fail(ERR.internal, `Skill ${call.name} failed`);
  }
}
