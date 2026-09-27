import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { openInBrowser } from '../../lib/tauri-bridge';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import './agent-manager.css';

export function AgentInstallGuide({
  desktopInstalled,
  compact = false,
}: {
  desktopInstalled?: boolean;
  compact?: boolean;
}) {
  const [error, setError] = useState('');
  return (
    <section
      className={compact ? 'agent-install-compact' : 'agent-install-guide'}
      aria-label="Antigravity CLI setup"
    >
      {!compact && (
        <p>
          {desktopInstalled ? 'Antigravity desktop is installed. ' : ''}Jackalope runs Antigravity
          tasks through the separate agy CLI. Install it, launch agy to sign in, then check agents
          again.
        </p>
      )}
      <Button
        variant="outline"
        onClick={async () => {
          const url = 'https://antigravity.google/docs/cli/install/';
          try {
            await openInBrowser(url);
          } catch (cause) {
            setError(String(cause));
          }
        }}
      >
        CLI setup guide
        <ExternalLink size={15} />
      </Button>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </section>
  );
}
