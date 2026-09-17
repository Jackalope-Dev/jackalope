import { ExternalLink } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { safeMarketplaceUrl } from './marketplace-info';

export function SourceLink({ url, children }: { url?: string | null; children: ReactNode }) {
  const href = safeMarketplaceUrl(url);
  const [error, setError] = useState(false);
  return href ? (
    <>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={async (event) => {
          if (!isTauriEnvironment()) return;
          event.preventDefault();
          try {
            const { open } = await import('@tauri-apps/plugin-shell');
            await open(href);
            setError(false);
          } catch {
            setError(true);
          }
        }}
      >
        {children}
        <ExternalLink size={13} aria-hidden="true" />
      </a>
      {error && <span role="alert">Could not open this link.</span>}
    </>
  ) : null;
}
