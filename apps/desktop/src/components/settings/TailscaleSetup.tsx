import { describeError } from '@jackalope/contracts/errors';
import { Button, InlineNotice } from '@jackalope/ui';
import { Check } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { openExternalUrl } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import {
  servePortMismatch,
  type TailscaleStatus,
  tailscaleEnableLink,
} from '../../lib/tailscale-setup';

const DOWNLOAD = 'https://tailscale.com/download';
const DNS_SETTINGS = 'https://login.tailscale.com/admin/dns';

interface Step {
  title: string;
  done: boolean;
  detail?: ReactNode;
  action?: ReactNode;
}

/**
 * Names the phones found on the tailnet. iPhones report their host name as "localhost", which
 * tells the person nothing, so only real names are listed and the rest are counted.
 */
function phonesFound(phones: string[]) {
  const named = phones.filter((name) => name.trim() && name.trim().toLowerCase() !== 'localhost');
  if (named.length === phones.length) return `Found ${named.join(', ')}.`;
  return named.length
    ? `Found ${named.join(', ')} and ${phones.length - named.length} more.`
    : `Found ${phones.length === 1 ? 'a phone' : `${phones.length} phones`} on your tailnet.`;
}

/**
 * Walks through private HTTPS with Tailscale, which phones need to reach this computer.
 * Each step shows what Jackalope can detect; the status refreshes when the window regains
 * focus, so finishing a step in Tailscale and coming back updates the list.
 */
export function TailscaleSetup({ turnOn }: { turnOn: () => Promise<void> }) {
  const [status, setStatus] = useState<TailscaleStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState('');
  const check = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await invokeNative<TailscaleStatus>('remote_tailscale_status'));
    } catch (cause) {
      setFailure(describeError(cause));
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    void check();
    const refresh = () => void check();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [check]);
  const start = async () => {
    if (working) return;
    setWorking(true);
    setFailure('');
    try {
      await turnOn();
    } catch (cause) {
      setFailure(describeError(cause));
      void check();
    } finally {
      setWorking(false);
    }
  };
  const enableLink = tailscaleEnableLink(failure);
  const mismatch = servePortMismatch(status);
  const link = (label: string, url: string, primary = false) => (
    <Button
      size="sm"
      variant={primary ? 'primary' : 'outline'}
      onClick={() => void openExternalUrl(url)}
    >
      {label}
    </Button>
  );
  const steps: Step[] = [
    {
      title: 'Install Tailscale on this computer',
      done: !!status?.installed,
      action: status && !status.installed && link('Download Tailscale', DOWNLOAD),
    },
    {
      title: 'Sign in to Tailscale',
      done: !!status?.signedIn,
      detail:
        status?.installed && !status.signedIn
          ? status.error || 'Open the Tailscale app and sign in.'
          : undefined,
    },
    {
      title: 'Install Tailscale on your phone with the same account',
      done: !!status?.phones.length,
      detail: status?.phones.length
        ? phonesFound(status.phones)
        : status?.signedIn && 'No phone on your tailnet yet.',
      action: status?.signedIn && !status.phones.length && link('Get the app', DOWNLOAD),
    },
    {
      title: 'Turn on MagicDNS and HTTPS certificates',
      done: !!status?.magicDns && !!status.https,
      detail: status?.signedIn && !(status.magicDns && status.https) && 'Both are on the DNS page.',
      action:
        status?.signedIn &&
        !(status.magicDns && status.https) &&
        link('Open DNS settings', DNS_SETTINGS),
    },
    {
      title: 'Turn on private HTTPS for Jackalope',
      done: false,
      detail: enableLink ? (
        <>
          Allow Serve for your tailnet in Tailscale, then try again.
          <span className="tailscale-item-error">{failure}</span>
        </>
      ) : undefined,
      action: enableLink ? (
        <>
          {link('Enable HTTPS in Tailscale', enableLink, true)}
          <Button
            size="sm"
            variant="outline"
            disabled={working}
            loading={working}
            loadingLabel="Turning on…"
            onClick={() => void start()}
          >
            Try again
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          disabled={!status?.signedIn || working}
          loading={working}
          loadingLabel="Turning on…"
          onClick={() => void start()}
        >
          Turn on private HTTPS
        </Button>
      ),
    },
  ];
  const done = steps.filter((step) => step.done);
  const left = steps.filter((step) => !step.done);
  // The last step never reports done, so there is always a next one.
  const [next, ...later] = left;
  const goal = steps[steps.length - 1];
  // A checklist rather than numbered steps: it sits inside a numbered setup step already.
  return (
    <div className="tailscale-setup">
      {!!done.length && (
        <div className="tailscale-done">
          <p className="tailscale-progress" role="status">
            {done.length} of {steps.length} done
          </p>
          <ul className="tailscale-checklist" aria-label="Done">
            {done.map((step) => (
              <li key={step.title}>
                <span className="tailscale-check" aria-hidden="true">
                  <Check size={10} strokeWidth={3} />
                </span>
                <span>
                  {step.title}
                  {step.detail && <span className="tailscale-item-detail"> – {step.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="tailscale-next">
        <p className="tailscale-next-title">
          <span className="tailscale-next-label">Next</span>
          {next.title}
        </p>
        {next.detail && <p className="tailscale-item-detail">{next.detail}</p>}
        {!!later.length && (
          <p className="tailscale-item-detail">
            After that: {later.map((step) => step.title).join(' · ')}
          </p>
        )}
      </div>
      {mismatch && (
        <InlineNotice tone="warning">
          Tailscale sends HTTPS to port {mismatch.serves}, but Jackalope here listens on{' '}
          {mismatch.listens}, so phones reach another app, or nothing if it isn't running. Turn on
          private HTTPS to point it here; anything else using port {mismatch.serves} stops getting
          it.
        </InlineNotice>
      )}
      {failure && !enableLink && <InlineNotice tone="error">{failure}</InlineNotice>}
      <div className="tailscale-actions">
        {next !== goal && next.action}
        {/* Turning on stays reachable from any step, as Tailscale's own checks can lag. */}
        {goal.action}
        <Button
          variant="outline"
          size="sm"
          disabled={checking}
          loading={checking}
          loadingLabel="Checking…"
          onClick={() => void check()}
        >
          Check again
        </Button>
      </div>
      <p className="tailscale-item-detail">
        Already have an HTTPS address? Enter it in Turn on remote access, under Advanced.
      </p>
    </div>
  );
}
