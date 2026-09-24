import type { McpServerConfig } from './tauri-bridge.ts';

export function bearerToken(extra: Record<string, unknown> = {}) {
  const headers = {
    ...((extra.http_headers as Record<string, unknown>) ?? {}),
    ...((extra.headers as Record<string, unknown>) ?? {}),
  };
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === 'authorization')?.[1];
  return typeof value === 'string' && /^Bearer /i.test(value) ? value.slice(7) : undefined;
}

export function withoutBearerToken(extra: Record<string, unknown>) {
  const { bearer_token_env_var: _bearer, ...rest } = extra;
  for (const field of ['headers', 'http_headers']) {
    if (rest[field] && typeof rest[field] === 'object')
      rest[field] = Object.fromEntries(
        Object.entries(rest[field] as object).filter(
          ([key]) => key.toLowerCase() !== 'authorization',
        ),
      );
  }
  return rest;
}

export function withBearerToken(extra: Record<string, unknown>, token: string) {
  const { bearer_token_env_var: _bearer, headers, http_headers, ...rest } = extra;
  const combined = {
    ...((http_headers as Record<string, unknown>) ?? {}),
    ...((headers as Record<string, unknown>) ?? {}),
  };
  return {
    ...rest,
    headers: {
      ...Object.fromEntries(
        Object.entries(combined).filter(([key]) => key.toLowerCase() !== 'authorization'),
      ),
      Authorization: `Bearer ${token}`,
    },
  };
}

export function connectionFailure(error?: string) {
  const value = error ?? '';
  if (/401|unauthoriz|oauth|invalid.grant|expired/i.test(value))
    return {
      title: 'Sign-in or credentials needed',
      detail:
        'Reconnect through your agent, or update the token in connection settings. Agent sign-ins cannot be checked by the native connection test.',
    };
  if (/403|forbidden|permission denied/i.test(value))
    return {
      title: 'Access was denied',
      detail: 'Check the account permissions and whether your organization allows this connection.',
    };
  if (/os error 2\b|not found|cannot find|no such file|executable/i.test(value))
    return {
      title: 'Local server could not start',
      detail: 'Check that the command and its runtime are installed and available to Jackalope.',
    };
  if (/timeout|timed out|deadline/i.test(value))
    return {
      title: 'The connection timed out',
      detail:
        'Check your network and server, then try checking again. The saved settings are still here.',
    };
  if (/legacy SSE/i.test(value))
    return {
      title: 'Check this connection in your agent',
      detail:
        'Native checks require a Streamable HTTP endpoint or local command. This connection uses legacy SSE.',
    };
  return {
    title: 'Connection could not be checked',
    detail: 'Review the endpoint, authentication, and local setup requirements, then try again.',
  };
}

export function redactConnection(server: McpServerConfig) {
  const redact = (value: unknown, key = ''): unknown => {
    if (/token|secret|password|authorization|credential|api.?key/i.test(key)) return '[REDACTED]';
    if (key === 'env' || key === 'headers' || key === 'http_headers')
      return Object.fromEntries(
        Object.keys((value ?? {}) as object).map((name) => [name, '[REDACTED]']),
      );
    if (Array.isArray(value)) return value.map(() => '[REDACTED]');
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([name, item]) => [name, redact(item, name)]),
      );
    return typeof value === 'string' ? '[REDACTED]' : value;
  };
  let url = server.url;
  if (url) {
    try {
      const parsed = new URL(url);
      parsed.username = '';
      parsed.password = '';
      parsed.hash = '';
      parsed.pathname = '/[REDACTED]';
      for (const key of [...parsed.searchParams.keys()]) parsed.searchParams.set(key, '[REDACTED]');
      url = parsed.href;
    } catch {
      url = '[REDACTED]';
    }
  }
  return {
    mcpServers: {
      [server.id]: {
        ...(redact(server.extra ?? {}) as Record<string, unknown>),
        ...(url
          ? { type: server.transport, url }
          : { command: '[REDACTED]', args: (server.args ?? []).map(() => '[REDACTED]') }),
        env: redact(server.env ?? {}, 'env'),
      },
    },
  };
}

export function effectiveConnections(servers: McpServerConfig[], projectId?: string) {
  const entries = new Map(
    servers
      .filter((server) => server.scope === 'global' && server.managed)
      .map((server) => [server.id, server]),
  );
  for (const server of servers) {
    if (server.scope === `project:${projectId}`) entries.set(server.id, server);
  }
  return [...entries.values()].filter((server) => server.enabled !== false);
}
