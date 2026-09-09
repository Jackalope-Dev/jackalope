import { Globe, Server } from 'lucide-react';
import { useState } from 'react';
import type { AllMcpsServer } from '../../stores/mcpStore';
import { marketplaceSetup, safeMarketplaceUrl } from './marketplace-info';

export function McpServerIcon({ server }: { server: AllMcpsServer }) {
  const [failed, setFailed] = useState(false);
  const source = safeMarketplaceUrl(server.url);
  const url = source ? new URL(source) : null;
  const publisher = url?.hostname === 'github.com' ? url.pathname.split('/')[1] : null;
  const avatar =
    publisher && /^[a-zA-Z0-9-]+$/.test(publisher)
      ? `https://github.com/${publisher}.png?size=128`
      : null;
  const Icon = marketplaceSetup(server).remote ? Globe : Server;
  return (
    <span className="mcp-server-icon">
      {avatar && !failed ? (
        <img
          src={avatar}
          alt={`${publisher} publisher icon`}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon size={30} aria-hidden="true" />
      )}
    </span>
  );
}
