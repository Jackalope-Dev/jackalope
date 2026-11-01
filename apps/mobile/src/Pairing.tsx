import { AsciiMark } from '@jackalope/brand/ascii-mark';
import { Button, FormField, Input } from '@jackalope/ui';
import { ChevronLeft, QrCode } from 'lucide-react';
import { useRef, useState } from 'react';
import { InlineNotice } from '../../desktop/src/components/ui/InlineNotice';
import { type Host, pair, scanPairingCode } from './native';

/** A starting name the person can keep: phones rarely need telling apart beyond their kind. */
function defaultName() {
  if (/iPhone|iPad/.test(navigator.userAgent)) return 'iPhone';
  if (/Android/.test(navigator.userAgent)) return 'Android phone';
  return 'My phone';
}

/**
 * Pairs this phone with a computer. Scanning the QR code Remote access shows is the quick
 * path; a pasted link, or an address and code when the computer has no HTTPS address, is
 * the fallback.
 */
export function Pairing({
  onPaired,
  onBack,
}: {
  onPaired: (host: Host) => void;
  onBack?: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [link, setLink] = useState('');
  const [withCode, setWithCode] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef(0);
  const connect = async (target: string, pairingCode?: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    const current = ++attempt.current;
    try {
      const host = await pair(target.trim(), name.trim() || defaultName(), pairingCode);
      if (current === attempt.current) onPaired(host);
    } catch (cause) {
      if (current === attempt.current) setError(String(cause));
    } finally {
      if (current === attempt.current) setBusy(false);
    }
  };
  const scan = async () => {
    setError('');
    try {
      const scanned = await scanPairingCode();
      if (scanned) await connect(scanned);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // Backing out of the camera is not a failure.
      if (!/cancel/i.test(message)) setError(message);
    }
  };
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
      <section
        className="mobile-card mobile-glass mobile-pairing-form"
        aria-labelledby="pair-title"
      >
        <div className="mobile-pairing-intro">
          <h2 id="pair-title">Connect to your computer</h2>
          <p>
            In Jackalope on your computer, open Settings → Remote access and create a pairing code.
          </p>
        </div>
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
        <Button
          size="lg"
          disabled={busy}
          loading={busy}
          loadingLabel="Connecting…"
          onClick={() => void scan()}
        >
          <QrCode size={18} aria-hidden="true" />
          Scan QR code
        </Button>
        <div className="mobile-divider">
          <span>or enter it</span>
        </div>
        <form
          className="mobile-pairing-fields"
          onSubmit={(event) => {
            event.preventDefault();
            void connect(link, withCode ? code.trim() : undefined);
          }}
        >
          <FormField label={withCode ? "Computer's address" : 'Pairing link'}>
            <Input
              value={link}
              disabled={busy}
              required
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              placeholder={withCode ? 'https://your-computer.example' : 'https://…/#pair=…'}
              onChange={(event) => setLink(event.target.value)}
            />
          </FormField>
          {withCode && (
            <FormField label="Pairing code">
              <Input
                value={code}
                disabled={busy}
                required
                type="password"
                autoComplete="off"
                autoCapitalize="none"
                onChange={(event) => setCode(event.target.value)}
              />
            </FormField>
          )}
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
            variant="outline"
            disabled={busy || !link.trim() || !name.trim() || (withCode && !code.trim())}
          >
            Connect
          </Button>
        </form>
        <button
          type="button"
          className="mobile-link-button"
          disabled={busy}
          onClick={() => {
            setWithCode((value) => !value);
            setError('');
          }}
        >
          {withCode ? 'Use a pairing link instead' : 'Use an address and code instead'}
        </button>
      </section>
    </main>
  );
}
