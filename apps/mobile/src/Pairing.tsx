import { AsciiMark } from '@jackalope/brand/ascii-mark';
import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  FlowDiagram,
  FormField,
  Input,
} from '@jackalope/ui';
import { ChevronLeft, Monitor, QrCode, Smartphone } from 'lucide-react';
import { useRef, useState } from 'react';
import { checkPairingCode, formatPairingCode } from '../../desktop/src/lib/remote-checks.ts';
import { type Host, pair, scanPairingCode } from './native';

/** A starting name the person can keep: phones rarely need telling apart beyond their kind. */
function defaultName() {
  if (/iPad/.test(navigator.userAgent)) return 'iPad';
  if (/iPhone/.test(navigator.userAgent)) return 'iPhone';
  if (/Android/.test(navigator.userAgent)) return 'Android phone';
  return 'My phone';
}

/** The clicks on the computer that bring up its pairing QR code. */
const COMPUTER_PATH = ['Devices', 'Let devices use this one', 'Pair a phone'];

/**
 * Pairs this phone with a computer. Scanning the QR code Devices shows is the path;
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
  const codeCheck = checkPairingCode(code);
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
          <p>Follow work, answer questions and start tasks on your computer from this phone.</p>
        </div>
        <ol className="mobile-steps">
          <li className="mobile-step">
            <span className="mobile-step-number" aria-hidden="true">
              1
            </span>
            <span className="mobile-step-body">
              <strong>On your computer, open Jackalope</strong>
              <span className="mobile-path">
                {COMPUTER_PATH.map((part, index) => (
                  <span key={part}>
                    {index > 0 && (
                      <span className="mobile-path-sep" aria-hidden="true">
                        ›
                      </span>
                    )}
                    <span className="mobile-path-chip">{part}</span>
                  </span>
                ))}
              </span>
            </span>
          </li>
          <li className="mobile-step">
            <span className="mobile-step-number" aria-hidden="true">
              2
            </span>
            <span className="mobile-step-body">
              <strong>Scan the QR code it shows</strong>
              <span className="mobile-step-hint">Each code works once, for five minutes.</span>
            </span>
          </li>
        </ol>
        {/* The link this screen is building, in its real state: waiting, connecting, or the
            computer's own refusal. */}
        <FlowDiagram
          className="mobile-flow"
          from={{ label: 'This phone', icon: <Smartphone size={16} /> }}
          to={{ label: 'Your computer', icon: <Monitor size={16} /> }}
          state={busy ? 'checking' : error ? 'failed' : 'idle'}
          error={error}
        />
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
                    aria-describedby="pair-code-check"
                    onChange={(event) => setCode(formatPairingCode(event.target.value))}
                  />
                </FormField>
              )}
              {!linked && codeCheck && (
                <p
                  id="pair-code-check"
                  className="mobile-field-check"
                  data-tone={codeCheck.tone}
                  aria-live="polite"
                >
                  {codeCheck.message}
                </p>
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
                disabled={
                  busy ||
                  !link.trim() ||
                  !name.trim() ||
                  (!linked && (!code.trim() || codeCheck?.tone === 'error'))
                }
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
