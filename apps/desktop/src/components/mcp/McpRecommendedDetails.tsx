import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { AllMcpsServer } from '../../stores/mcpStore';
import { Button } from '../ui/button';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { recommendationFor } from './curated-servers';
import { McpServerIcon } from './McpServerIcon';
import { SourceLink } from './McpSourceLink';
import { marketplaceSetup } from './marketplace-info';

export function McpRecommendedDetails({
  server,
  scopes,
  onClose,
  onConfigure,
}: {
  server: AllMcpsServer;
  scopes: string[];
  onClose: () => void;
  onConfigure: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const recommendation = recommendationFor(server.id);
  if (!recommendation) return null;
  const setup = marketplaceSetup(server);
  return (
    <section className="mcp-server-page" aria-label={`${server.name} details`}>
      <WorkspaceHeading
        title={server.name}
        titleRef={heading}
        description={`Published by ${recommendation.publisher}`}
        icon={<McpServerIcon server={server} />}
        action={
          <Button variant="ghost" onClick={onClose}>
            <ArrowLeft size={16} /> Back to marketplace
          </Button>
        }
      />
      <div className="mcp-detail-content mcp-recommended-detail">
        <p className="mcp-detail-description">{server.description}</p>
        <div className="mcp-market-labels">
          <span>Selected by Jackalope</span>
          <span>{setup.remote ? 'Remote server' : 'Local process'}</span>
        </div>
        <section>
          <h3>What you need</h3>
          <p>{recommendation.setup}</p>
        </section>
        <section>
          <h3>Connection</h3>
          <code className="mcp-preset-endpoint">
            {setup.config?.url ?? [setup.config?.command, ...(setup.config?.args ?? [])].join(' ')}
          </code>
        </section>
        {recommendation.authentication === 'oauth' && (
          <p>
            Uses a direct connection through Codex or Claude. Sign in through each selected agent
            after saving; Jackalope does not verify that agent’s login.
          </p>
        )}
        {!setup.remote && (
          <p>
            This package runs on your computer with your user’s access. Saving and checking starts
            it and may download the package.
          </p>
        )}
        {scopes.length > 0 && <p>Configured in {scopes.join(', ')}.</p>}
        <div className="mcp-detail-links">
          <SourceLink url={recommendation.documentation}>Publisher setup guide</SourceLink>
          <SourceLink url={server.url}>Publisher source</SourceLink>
          <SourceLink url={server.detailUrl}>View on AllMCPs</SourceLink>
        </div>
        <p className="task-muted">
          Selected from publisher documentation. Available tools and access depend on your account
          and service permissions.
        </p>
        <div>
          <Button onClick={onConfigure}>
            {scopes.length ? 'Manage connection' : 'Configure server'}
          </Button>
        </div>
      </div>
    </section>
  );
}
