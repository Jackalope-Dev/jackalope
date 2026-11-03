import { Button } from '@jackalope/ui';
import { Check } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { type TailscaleStatus, tailscaleEnableLink } from '../../lib/tailscale-setup';
import { nativeTask } from '../../lib/task-runtime';
import { openExternalUrl } from '../../lib/tauri-bridge';
import { InlineNotice } from '../ui/InlineNotice';

const DOWNLOAD = 'https://tailscale.com/download';
const DNS_SETTINGS = 'https://login.tailscale.com/admin/dns';

interface Step {
  title: string;
  done: boolean;
  detail?: ReactNode;
  action?: ReactNode;
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
      setStatus(await nativeTask<TailscaleStatus>('remote_tailscale_status'));
    } catch (cause) {
      setFailure(String(cause));
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
      setFailure(String(cause));
      void check();
    } finally {
      setWorking(false);
    }
  };
  const enableLink = tailscaleEnableLink(failure);
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
        ? `Found ${status.phones.join(', ')}.`
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
          <span className="remote-step-error">{failure}</span>
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
  return (
    <div className="remote-setup-steps px-5 py-4">
      <h3>Connect your phone with Tailscale</h3>
      <p className="task-muted">
        Phones reach this computer over private HTTPS. Tailscale sets it up for free, and only your
        devices can connect.
      </p>
      <ol className="remote-steps">
        {steps.map((step, index) => (
          <li key={step.title} data-done={step.done || undefined}>
            <span className="remote-step-mark" aria-hidden="true">
              {step.done ? <Check size={14} /> : index + 1}
            </span>
            <div className="remote-step-body">
              <strong className="remote-step-title">
                {step.title}
                <span className="sr-only">{step.done ? ' (done)' : ''}</span>
              </strong>
              {step.detail && <p className="task-muted">{step.detail}</p>}
              {step.action && <div className="remote-toolbar">{step.action}</div>}
            </div>
          </li>
        ))}
      </ol>
      {failure && !enableLink && <InlineNotice tone="error">{failure}</InlineNotice>}
      <div className="remote-toolbar">
        <Button
          variant="ghost"
          size="sm"
          disabled={checking}
          loading={checking}
          loadingLabel="Checking…"
          onClick={() => void check()}
        >
          Check again
        </Button>
        <span>Already have an HTTPS address? Enter it under Advanced.</span>
      </div>
    </div>
  );
}
