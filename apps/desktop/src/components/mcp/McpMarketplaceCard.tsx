import { ArrowRight, Check, Globe, Server, Shield, Star } from 'lucide-react';
import type { AllMcpsServer } from '../../stores/mcpStore';
import { Button } from '../ui/button';
import {
  categoryLabel,
  descriptionExcerpt,
  marketplaceName,
  marketplaceSetup,
  scopeLabel,
  sourceLabel,
} from './marketplace-info';

export function McpMarketplaceCard({
  server,
  scopes,
  onInspect,
  onConfigure,
}: {
  server: AllMcpsServer;
  scopes: string[];
  onInspect: () => void;
  onConfigure: () => void;
}) {
  const setup = marketplaceSetup(server);
  const Icon = setup.remote ? Globe : Server;
  return (
    <article className="mcp-market-card" aria-label={server.name}>
      <div className="mcp-market-heading">
        <span className="mcp-market-icon">
          <Icon size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="mcp-card-title">
            <button type="button" onClick={onInspect}>
              {marketplaceName(server)}
            </button>
          </h3>
          <p className="mcp-market-source">{sourceLabel(server.url)}</p>
        </div>
      </div>
      <div className="mcp-market-labels">
        <span>{categoryLabel(server.category)}</span>
        {server.isOfficial && (
          <span title="Listed as official by AllMCPs">
            <Shield size={12} aria-hidden="true" /> Official
          </span>
        )}
        {server.githubStars > 0 && (
          <span title={`${server.githubStars.toLocaleString()} GitHub stars`}>
            <Star size={12} aria-hidden="true" />{' '}
            {Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
              server.githubStars,
            )}{' '}
            stars
          </span>
        )}
      </div>
      <p className="mcp-market-description">
        {descriptionExcerpt(
          server.description || 'No description supplied. Open details for setup information.',
        )}
      </p>
      <dl className="mcp-market-facts">
        <div>
          <dt>Connection</dt>
          <dd>{setup.remote ? 'Remote server' : 'Local process'}</dd>
        </div>
        <div>
          <dt>Setup fields</dt>
          <dd>{setup.envVars.length ? `${setup.envVars.length} to configure` : 'None listed'}</dd>
        </div>
      </dl>
      <div className="mcp-market-status">
        {scopes.length > 0 ? (
          <span className="text-[var(--color-success)]">
            <Check size={14} aria-hidden="true" /> Configured: {scopes.map(scopeLabel).join(', ')}
          </span>
        ) : (
          <span>
            {setup.reviewNeeded ? 'Review suggested setup' : 'Setup instructions available'}
          </span>
        )}
      </div>
      <div className="mcp-card-footer">
        <Button variant="ghost" size="sm" onClick={onConfigure}>
          {scopes.length ? 'Reconfigure' : 'Configure'}
        </Button>
        <Button variant="outline" size="sm" onClick={onInspect}>
          View details <ArrowRight size={14} aria-hidden="true" />
        </Button>
      </div>
    </article>
  );
}
