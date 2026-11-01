import { AsciiMark } from '@jackalope/brand/ascii-mark';
import { Button, FormField, Input } from '@jackalope/ui';
import { ChevronLeft } from 'lucide-react';
import { useRef, useState } from 'react';
import { InlineNotice } from '../../desktop/src/components/ui/InlineNotice';
import { type Host, pair } from './native';

/** Pairs this phone with a computer from the link its Remote access settings show. */
export function Pairing({
  onPaired,
  onBack,
}: {
  onPaired: (host: Host) => void;
  onBack?: () => void;
}) {
  const [name, setName] = useState('My phone');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef(0);
  return (
    <main className="mobile-screen mobile-pairing">
      {onBack && (
        <header className="mobile-bar mobile-glass">
          <button type="button" className="mobile-icon-button" aria-label="Back" onClick={onBack}>
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
          <h1>Pair a computer</h1>
        </header>
      )}
      <div className="mobile-pairing-hero" aria-hidden="true">
        <AsciiMark className="mobile-pairing-mark" echoes={4} />
      </div>
      <form
        className="mobile-card mobile-glass mobile-pairing-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          const current = ++attempt.current;
          try {
            const host = await pair(link.trim(), name.trim());
            if (current === attempt.current) onPaired(host);
          } catch (cause) {
            if (current === attempt.current) setError(String(cause));
          } finally {
            if (current === attempt.current) setBusy(false);
          }
        }}
      >
        <h2>Connect to your computer</h2>
        <p>
          In Jackalope on your computer, open Settings → Remote access, create a pairing link and
          paste it here.
        </p>
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
        <FormField label="Pairing link">
          <Input
            value={link}
            disabled={busy}
            required
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://…/companion.html#pair=…"
            onChange={(event) => setLink(event.target.value)}
          />
        </FormField>
        <FormField label="This phone's name">
          <Input
            value={name}
            disabled={busy}
            required
            maxLength={80}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <Button
          type="submit"
          loading={busy}
          loadingLabel="Connecting…"
          disabled={busy || !link.trim() || !name.trim()}
        >
          Connect
        </Button>
      </form>
    </main>
  );
}
