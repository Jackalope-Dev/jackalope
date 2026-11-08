import { AsciiMark } from '@jackalope/brand/ascii-mark';
import {
  Button,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  FormField,
  InlineNotice,
  Input,
} from '@jackalope/ui';
import { ChevronLeft, QrCode } from 'lucide-react';
import { useRef, useState } from 'react';
import { type Host, pair, scanPairingCode } from './native';
import { describeError } from '@jackalope/contracts/errors';

/** A starting name the person can keep: phones rarely need telling apart beyond their kind. */
function defaultName() {
  if (/iPad/.test(navigator.userAgent)) return 'iPad';
  if (/iPhone/.test(navigator.userAgent)) return 'iPhone';
  if (/Android/.test(navigator.userAgent)) return 'Android phone';
  return 'My phone';
}

/**
 * Pairs this phone with a computer. Scanning the QR code Remote access shows is the path;
 * typing the computer's address and code, or pasting a pairing link, waits in a collapsed
 * section with the phone's name, which the computer fills in from its owner when generic.
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
  const [code, setCode] = useState('');
  // A pasted pairing link carries its own code.
  const linked = /#pair=/.test(link);
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
      if (current === attempt.current) setError(describeError(cause));
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
      const message = describeError(cause);
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
            On your computer, open Jackalope → Settings → Remote access, create a pairing code and
            scan it.
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
        <Disclosure className="mobile-pairing-manual">
          <DisclosureSummary>Enter a code instead</DisclosureSummary>
          <DisclosureBody>
            <form
              className="mobile-pairing-fields"
              onSubmit={(event) => {
                event.preventDefault();
                void connect(link, linked ? undefined : code.trim());
              }}
            >
              <FormField label="Computer's address" description="Or paste a pairing link.">
                <Input
                  value={link}
                  disabled={busy}
                  required
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  autoCapitalize="none"
                  placeholder="https://your-computer.example"
                  onChange={(event) => setLink(event.target.value)}
                />
              </FormField>
              {!linked && (
                <FormField label="Pairing code">
                  <Input
                    className="mobile-pairing-code"
                    value={code}
                    disabled={busy}
                    required
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="ABCDE-FGHJK"
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
                disabled={busy || !link.trim() || !name.trim() || (!linked && !code.trim())}
              >
                Connect
              </Button>
            </form>
          </DisclosureBody>
        </Disclosure>
      </section>
    </main>
  );
}
