import type { AllMcpsServer } from '../../stores/mcpStore';

export function safeMarketplaceUrl(value?: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function sourceLabel(value: string) {
  const safe = safeMarketplaceUrl(value);
  if (!safe) return 'Source not listed';
  const url = new URL(safe);
  return url.hostname === 'github.com'
    ? url.pathname.replace(/^\//, '').replace(/\/$/, '')
    : url.hostname;
}

export function categoryLabel(category: string | null) {
  return category?.replace(/^[^\p{L}\p{N}]+/u, '') || 'Uncategorized';
}

export function marketplaceName(server: AllMcpsServer) {
  return server.name === sourceLabel(server.url)
    ? server.name.split('/').at(-1) || server.name
    : server.name;
}

export function marketplaceSetup(server: AllMcpsServer) {
  const configs = Object.values(server.claudeConfigSnippet?.mcpServers ?? {});
  const config = configs[0];
  const envVars = [...new Set([...(server.envVars ?? []), ...Object.keys(config?.env ?? {})])];
  return {
    config,
    envVars,
    remote: server.installKind === 'remote' || Boolean(config?.url),
    reviewNeeded: server.installConfidence !== 'high',
  };
}

export function scopeLabel(scope: string) {
  return (
    (
      { global: 'Global', claude: 'Claude Code', codex: 'Codex', grok: 'Grok' } as Record<
        string,
        string
      >
    )[scope] ?? scope
  );
}

export function descriptionExcerpt(description: string) {
  if (description.length <= 190) return description;
  return `${description.slice(0, 190).replace(/\s+\S*$/, '')}…`;
}
