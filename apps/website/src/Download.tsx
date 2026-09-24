import { Badge, Button, InlineNotice } from '@jackalope/ui';
import {
  ArrowDownToLine,
  ArrowRight,
  Command,
  Monitor,
  Play,
  Terminal,
  Ticket,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AccessRequestError, accessMessage, accessOrigin, accessRequest } from './access-api';
import { BrandMark } from './BrandMark';
import { desktopDownloads } from './download-config';
import {
  type DesktopPlatform,
  detectDesktopPlatform,
  type PlatformDownload,
} from './platform-downloads';
import { WaitlistButton } from './Signup';
import './download.css';

const platformIcons = { windows: Monitor, macos: Command, linux: Terminal };
interface DownloadMember {
  email: string;
  download?: { kind?: 'store' } | null;
  /** macOS builds this member can download while they are not public. */
  macos?: { id: string; label: string; url: string }[];
}

export function DownloadPage({ downloads = desktopDownloads }: { downloads?: PlatformDownload[] }) {
  const [platform, setPlatform] = useState<DesktopPlatform | null>(null);
  const [member, setMember] = useState<DownloadMember | null>(null);
  const email = member?.email ?? '';
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const accountRequest = useRef<AbortController | null>(null);
  const confirmation = useRef<HTMLHeadingElement>(null);
  const accessHeading = useRef<HTMLHeadingElement>(null);
  const focusAccess = useRef(false);
  useEffect(() => {
    const browser = navigator as Navigator & { userAgentData?: { platform?: string } };
    setPlatform(
      detectDesktopPlatform({
        platform: browser.userAgentData?.platform || browser.platform,
        userAgent: browser.userAgent,
        maxTouchPoints: browser.maxTouchPoints,
      }),
    );
    function readLink() {
      const current = new URL(window.location.href);
      const raw = new URLSearchParams(current.hash.slice(1)).get('token');
      if (!raw) return;
      history.replaceState(null, '', current.pathname + current.search);
      if (/^[a-f0-9]{64}$/.test(raw)) {
        setToken(raw);
        setError('');
      } else {
        setToken('');
        setError('This link is incomplete. Request a new sign-in link.');
      }
    }
    readLink();
    window.addEventListener('hashchange', readLink);
    const controller = new AbortController();
    accountRequest.current = controller;
    if (accessOrigin) {
      void accessRequest<DownloadMember>('me', undefined, controller.signal)
        .then((member) => {
          if (!controller.signal.aborted) setMember(member);
        })
        .catch(() => undefined);
    }
    return () => {
      accountRequest.current?.abort();
      window.removeEventListener('hashchange', readLink);
    };
  }, []);
  useEffect(() => {
    if (token) confirmation.current?.focus({ preventScroll: true });
  }, [token]);
  useEffect(() => {
    if (member && !token && focusAccess.current) {
      accessHeading.current?.focus();
      focusAccess.current = false;
    }
  }, [member, token]);
  async function accept() {
    if (pending.current) return;
    pending.current = true;
    accountRequest.current?.abort();
    const controller = new AbortController();
    accountRequest.current = controller;
    setBusy(true);
    setError('');
    setMember(null);
    try {
      await accessRequest('accept', { token }, controller.signal);
      setToken('');
      const member = await accessRequest<DownloadMember>('me', undefined, controller.signal);
      focusAccess.current = true;
      setMember(member);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof AccessRequestError && failure.code === 'link_expired') setToken('');
      setError(accessMessage(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const ordered = [...downloads].sort(
    (a, b) => Number(b.id === platform) - Number(a.id === platform),
  );
  return (
    <main id="main" className="download-page page-width">
      <header className="download-heading">
        <div>
          <p className="download-eyebrow">Your next workspace</p>
          <h1>Download Jackalope.</h1>
          <p className="download-lede">
            A little more room for your projects, coding agents, and ideas.
          </p>
        </div>
        <div className="download-app-icon" aria-hidden="true">
          <BrandMark />
        </div>
      </header>

      {error && (
        <InlineNotice tone="error" className="download-notice">
          {error} <a href="/access/">Get a fresh link</a>.
        </InlineNotice>
      )}
      {token && (
        <section className="download-confirmation" aria-labelledby="download-confirm-title">
          <div>
            <h2 id="download-confirm-title" tabIndex={-1} ref={confirmation}>
              Confirm your early access.
            </h2>
            <p>Verify your email to sign in or claim your friend’s pass.</p>
            <p className="download-terms">
              By continuing, you confirm you’re 18 or older and agree to the{' '}
              <a href="/terms/">Terms</a>. See our <a href="/privacy/">Privacy Policy</a>.
            </p>
          </div>
          <Button
            variant="primary"
            onClick={accept}
            loading={busy}
            loadingLabel="Confirming…"
            disabled={!accessOrigin}
          >
            Confirm email <ArrowRight size={17} />
          </Button>
          {!accessOrigin && (
            <p role="status">
              Email confirmation is temporarily unavailable. Please try again later.
            </p>
          )}
        </section>
      )}

      <section className="download-platforms" aria-label="Desktop downloads">
        {ordered.map((option) => {
          const Icon = platformIcons[option.id];
          return (
            <article
              className={`download-platform${option.id === platform ? ' download-platform-detected' : ''}`}
              key={option.id}
              data-platform={option.id}
            >
              <div className="download-platform-top">
                <Icon size={28} strokeWidth={1.5} aria-hidden="true" />
                {option.id === platform && <span className="download-detected">Your platform</span>}
              </div>
              <h2>{option.name}</h2>
              <p>{option.detail}</p>
              <div className="download-platform-action">
                {!option.url && option.id === 'macos' && member?.macos?.length ? (
                  member.macos.map((build, index) => (
                    <a
                      key={build.id}
                      className={`button ${index === 0 ? 'button-primary' : 'button-quiet'}`}
                      href={build.url}
                    >
                      Download for {build.label} <ArrowDownToLine size={17} />
                    </a>
                  ))
                ) : option.url ? (
                  <a
                    className="button button-primary"
                    href={
                      option.store && member?.download?.kind === 'store'
                        ? `${accessOrigin}/v1/access/download`
                        : option.url
                    }
                  >
                    {option.store ? 'Get it from Microsoft Store' : `Download for ${option.name}`}{' '}
                    <ArrowDownToLine size={17} />
                  </a>
                ) : (
                  <Badge appearance="plain">Coming soon</Badge>
                )}
              </div>
            </article>
          );
        })}
      </section>
      <p className="download-platform-note">
        {platform
          ? 'Using another computer? All platforms are listed above.'
          : 'Jackalope is a desktop app. Choose the platform you use on your computer.'}
      </p>

      <section className="download-access" aria-labelledby="download-access-title">
        <div className="download-access-copy">
          <Ticket size={23} strokeWidth={1.5} aria-hidden="true" />
          <div>
            <h2 id="download-access-title" ref={accessHeading} tabIndex={-1}>
              {email && !token ? 'Your early access is approved.' : 'An invitation to get started.'}
            </h2>
            <p>
              {email && !token
                ? `You’re signed in as ${email}. ${downloads.some((option) => option.url) || member?.macos?.length ? 'Choose your platform above to get started.' : 'Downloads are coming soon. Your early access is ready when they arrive.'}`
                : 'Jackalope is in early access. You’ll need to be accepted from the waitlist or claim a friend’s Instant Access Pass to start using the app.'}
            </p>
            {email && !token ? (
              <a className="text-link" href="/access/#invitations">
                Your account & friend passes <ArrowRight size={15} />
              </a>
            ) : (
              <p className="download-pass-note">
                Have a friend pass? Open your invite link or{' '}
                <a href="/access/">sign in with your invited email</a>.
              </p>
            )}
          </div>
        </div>
        {!email && !token && <WaitlistButton />}
      </section>
      <nav className="download-explore" aria-label="Learn about Jackalope">
        <a href="/tour/">
          <Play size={16} aria-hidden="true" /> Take the app tour{' '}
          <ArrowRight size={15} aria-hidden="true" />
        </a>
        <a href="/knowledge/">
          Get to know your workspace <ArrowRight size={15} aria-hidden="true" />
        </a>
        <a href="/waitlist/">
          Check your place in line <ArrowRight size={15} aria-hidden="true" />
        </a>
      </nav>
    </main>
  );
}
