import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  Copy,
  LoaderCircle,
  LogOut,
  Mail,
  Share2,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AccessRequestError, accessMessage, accessOrigin, accessRequest } from './access-api';
import { ConnectedDesktops, DesktopConnection } from './DesktopConnection';
import './access.css';
import './waitlist.css';
import { BrandMark } from './BrandMark';

interface Invitation {
  id: string;
  email: string;
  status: string;
  expires_at: number;
  accepted_at: number | null;
  downloaded_at: number | null;
  connected_at: number | null;
  last_sent: number;
}
interface Membership {
  email: string;
  limit: number;
  remaining: number;
  accepted: number;
  downloaded: number;
  connected: number;
  shareUrl: string;
  invites: Invitation[];
  download: { url: string; bytes?: number; kind?: 'store' } | null;
}

const invitationMessage =
  'I have an Instant Access Pass to Jackalope: one cross-platform workspace for coding agents, Git worktrees, and review. Skip the waitlist after verifying your email, while a pass is available.';

export function AccessPage() {
  const [member, setMember] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [token, setToken] = useState('');
  const [invite, setInvite] = useState('');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [sent, setSent] = useState(false);
  const pending = useRef(false);
  const refreshMembership = useCallback(() => {
    void accessRequest<Membership>('me')
      .then((value) => {
        setMember(value);
        setError('');
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (member && window.location.hash === '#invitations')
      requestAnimationFrame(() => document.getElementById('invitations')?.scrollIntoView());
  }, [member]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const share = url.searchParams.get('invite');
    function readLink() {
      const current = new URL(window.location.href);
      const raw = new URLSearchParams(current.hash.slice(1)).get('token');
      if (raw) {
        history.replaceState(null, '', current.pathname + current.search);
        if (/^[a-f0-9]{64}$/.test(raw)) {
          setToken(raw);
          setError('');
        } else setError('This link is incomplete. Request a new sign-in link below.');
      }
    }
    readLink();
    window.addEventListener('hashchange', readLink);
    if (share && /^[a-f0-9]{64}$/.test(share)) setInvite(share);
    const controller = new AbortController();
    async function load() {
      try {
        setMember(await accessRequest<Membership>('me', undefined, controller.signal));
      } catch (e) {
        if (!(e instanceof AccessRequestError && e.status === 401) && !controller.signal.aborted)
          setError(accessMessage(e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
      if (share && /^[a-f0-9]{64}$/.test(share)) {
        try {
          setAvailable(
            (
              await accessRequest<{ available: boolean }>(
                `invitation/${share}`,
                undefined,
                controller.signal,
              )
            ).available,
          );
        } catch {
          if (!controller.signal.aborted) setAvailable(false);
        }
      }
    }
    if (accessOrigin) void load();
    else setLoading(false);
    return () => {
      controller.abort();
      window.removeEventListener('hashchange', readLink);
    };
  }, []);
  async function act(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError(accessMessage(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function accept() {
    await act(async () => {
      await accessRequest('accept', { token });
      setToken('');
      setMember(await accessRequest<Membership>('me'));
      setNotice('You’re signed in.');
    });
  }
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await act(async () => {
      await accessRequest('link', {
        email: String(data.get('email') || '').trim(),
        website: String(data.get('website') || ''),
        ...(invite ? { invite } : {}),
      });
      setSent(true);
    });
  }
  async function sendInvites(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const emails = [
      ...new Set(
        String(new FormData(form).get('emails') || '')
          .split(/[\s,;]+/)
          .filter(Boolean)
          .map((e) => e.toLowerCase()),
      ),
    ];
    if (!emails.length || emails.length > 5 || emails.some((e) => !/^\S+@\S+\.\S+$/.test(e))) {
      setError('Add one to five valid email addresses, separated by commas or new lines.');
      return;
    }
    await act(async () => {
      const updated = await accessRequest<Membership>('invites', { emails });
      setMember((current) => (current ? { ...current, ...updated } : current));
      form.reset();
      setNotice(
        'Invitations requested. Check their status below. Recent duplicate requests are limited.',
      );
    });
  }
  async function change(id: string, action: 'resend' | 'revoke') {
    await act(async () => {
      const updated = await accessRequest<Membership>('invites/change', { id, action });
      setMember((current) => (current ? { ...current, ...updated } : current));
      setNotice(
        action === 'resend'
          ? 'Invitation resend requested. Recent duplicate emails are limited.'
          : 'Pass withdrawn. That place is available again.',
      );
    });
  }
  async function share(target: 'native' | 'x' | 'linkedin' | 'bluesky') {
    if (!member) return;
    const complete = `${invitationMessage}\n\n${member.shareUrl}`;
    if (target === 'native' && navigator.share) {
      try {
        await navigator.share({
          title: 'Jackalope early access',
          text: invitationMessage,
          url: member.shareUrl,
        });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          setError('Could not open sharing. Copy the invitation message instead.');
      }
      return;
    }
    const url =
      target === 'x'
        ? `https://x.com/intent/post?text=${encodeURIComponent(complete)}`
        : target === 'linkedin'
          ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(member.shareUrl)}`
          : `https://bsky.app/intent/compose?text=${encodeURIComponent(complete)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  return (
    <main id="main" className={`access-page page-width${member ? ' access-page-member' : ''}`}>
      <header className="access-heading">
        <h1>{member ? 'Your access' : invite ? 'You’re invited' : 'Early access'}</h1>
        {member && <p>Download Jackalope and share your Instant Access Passes.</p>}
      </header>
      {error && (
        <p className="access-alert" role="alert">
          {error}
        </p>
      )}
      <p className="access-notice" role="status" aria-live="polite">
        {notice}
      </p>
      {loading ? (
        <div className="access-loading" role="status">
          <LoaderCircle className="signup-spinner" size={22} /> Loading…
        </div>
      ) : null}
      <DesktopConnection email={member?.email ?? null} refreshMembership={refreshMembership} />
      {loading ? null : !accessOrigin ? (
        <section className="access-card access-entry">
          <h2>Join the waitlist</h2>
          <p>Sign-in is not available yet. Join the waitlist to hear when early access opens.</p>
          <a className="button button-primary" href="/#newsletter">
            Join the waitlist <ArrowRight size={17} />
          </a>
        </section>
      ) : member ? (
        <>
          <div className="access-identity">
            <span>{member.email}</span>
            <button
              className="text-link"
              type="button"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await accessRequest('logout', {});
                  setMember(null);
                  setSent(false);
                  setToken('');
                })
              }
            >
              Sign out <LogOut size={14} />
            </button>
          </div>
          <nav className="member-navigation" aria-label="Your account">
            <a href="#setup">Get started</a>
            <a href="#invitations">Instant Access Passes</a>
            <a href="#desktops">Connected desktops</a>
          </nav>
          <section id="setup" className="access-card access-download">
            <div>
              <h2>Make room for your first task.</h2>
              {member.download ? (
                <a
                  className="button button-primary button-download"
                  href={`${accessOrigin}/v1/access/download`}
                >
                  <span className="access-progress-copy">
                    {member.download.kind === 'store'
                      ? 'Get it from Microsoft Store'
                      : 'Download for Windows'}
                  </span>
                  <ArrowDownToLine size={18} />
                </a>
              ) : (
                <div className="access-release">
                  <ArrowDownToLine size={22} />
                  <div>
                    <strong>No download available yet</strong>
                    <p>
                      Your access is approved. Downloads will appear here when they’re ready. Our
                      first launch is planned for macOS, Windows, and Linux.
                    </p>
                  </div>
                </div>
              )}
              <small>Bring a supported coding agent and its provider account.</small>
            </div>
            <ol className="access-steps">
              <li>
                <span>01</span>
                <div>
                  <h3>Open a project</h3>
                  <p>Install Jackalope, then open a local Git repository.</p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <h3>Connect an agent</h3>
                  <p>Choose an installed coding agent and sign in with your provider account.</p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <h3>Start a task</h3>
                  <p>
                    Describe the work, follow its progress, and review the changes before accepting
                    them.
                  </p>
                </div>
              </li>
            </ol>
          </section>
          <section
            id="invitations"
            className="access-card access-invitations"
            aria-labelledby="invite-heading"
          >
            <div className="access-invite-intro">
              <div>
                <h2 id="invite-heading">Bring your people.</h2>
                <p>
                  Your {member.limit} Instant Access Passes let people skip the waitlist after email
                  verification. Once accepted, they get five passes of their own.
                </p>
              </div>
              <div className="access-places">
                <strong>
                  {member.remaining}
                  <span>/{member.limit}</span>
                </strong>
                <small>passes available</small>
                {!!member.accepted && (
                  <span>
                    {member.accepted} accepted · {member.downloaded} downloaded · {member.connected}{' '}
                    connected
                  </span>
                )}
              </div>
            </div>
            <ol className="pass-strip" aria-label="Instant Access Pass allowance">
              {Array.from({ length: Math.min(member.limit, 100) }, (_, index) => index + 1).map(
                (passNumber) => {
                  const state =
                    passNumber <= member.accepted
                      ? 'Claimed'
                      : passNumber <= member.limit - member.remaining
                        ? 'Reserved'
                        : 'Available';
                  return (
                    <li key={passNumber} data-state={state}>
                      <BrandMark />
                      <strong>Instant Access</strong>
                      <span>
                        Pass {String(passNumber).padStart(2, '0')} · {state}
                      </span>
                    </li>
                  );
                },
              )}
            </ol>
            <p className="access-fine">
              Your shared pass link draws from this allowance. Email passes reserve a place for
              seven days. <a href="/waitlist/">Your unlimited waitlist link</a> stays separate and
              never spends a pass.
            </p>
            <div className="access-invite-options">
              <div>
                <h3>
                  <Mail size={18} /> Send a pass by email
                </h3>
                <p>Reserve a place for seven days. If it isn’t accepted, you can use it again.</p>
                <form onSubmit={sendInvites}>
                  <label htmlFor="invite-emails">Email addresses</label>
                  <textarea
                    id="invite-emails"
                    name="emails"
                    rows={3}
                    required
                    maxLength={1300}
                    placeholder={'friend@example.com\nanother@example.com'}
                    disabled={busy || member.remaining === 0}
                    aria-describedby="invite-emails-help"
                  />
                  <small id="invite-emails-help">
                    Up to five addresses, separated by commas or new lines.
                  </small>
                  <button
                    className="button button-primary button-download"
                    disabled={busy || member.remaining === 0}
                    type="submit"
                  >
                    Send passes <ArrowRight size={17} />
                  </button>
                </form>
              </div>
              <div>
                <h3>
                  <Copy size={18} /> Share a pass link
                </h3>
                <p>
                  Places are claimed when recipients verify their email. This link works while you
                  have passes available.
                </p>
                <label htmlFor="share-link">Your pass link</label>
                <input
                  id="share-link"
                  readOnly
                  value={member.shareUrl}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy || member.remaining === 0}
                  onClick={() =>
                    act(async () => {
                      await navigator.clipboard.writeText(member.shareUrl);
                      setNotice('Pass link copied.');
                    })
                  }
                >
                  <Copy size={16} /> Copy pass link
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy || member.remaining === 0}
                  onClick={() =>
                    act(async () => {
                      await navigator.clipboard.writeText(
                        `${invitationMessage}\n\n${member.shareUrl}`,
                      );
                      setNotice('Pass message copied.');
                    })
                  }
                >
                  <Copy size={16} /> Copy message
                </button>
                <div className="access-share-actions">
                  {typeof navigator.share === 'function' && (
                    <button
                      type="button"
                      disabled={busy || member.remaining === 0}
                      onClick={() => void share('native')}
                    >
                      <Share2 size={15} /> Share
                    </button>
                  )}
                  <a
                    aria-disabled={member.remaining === 0}
                    tabIndex={member.remaining ? undefined : -1}
                    onClick={(event) => {
                      if (!member.remaining) event.preventDefault();
                    }}
                    href={`mailto:?subject=${encodeURIComponent('Try Jackalope early access')}&body=${encodeURIComponent(`${invitationMessage}\n\n${member.shareUrl}`)}`}
                  >
                    Email
                  </a>
                  <button
                    type="button"
                    disabled={member.remaining === 0}
                    onClick={() => void share('x')}
                  >
                    X
                  </button>
                  <button
                    type="button"
                    disabled={member.remaining === 0}
                    onClick={() => void share('linkedin')}
                  >
                    LinkedIn
                  </button>
                  <button
                    type="button"
                    disabled={member.remaining === 0}
                    onClick={() => void share('bluesky')}
                  >
                    Bluesky
                  </button>
                </div>
                <small>
                  You’ll see who accepts, requests a download, and connects a desktop, not their
                  projects or task activity.
                </small>
              </div>
            </div>
            {member.invites.length > 0 && (
              <div className="access-invite-list">
                <h3>Your people</h3>
                <ul>
                  {member.invites.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.email}</strong>
                        <small>
                          {item.connected_at
                            ? 'Connected Jackalope'
                            : item.downloaded_at
                              ? 'Opened the download'
                              : item.status === 'accepted'
                                ? 'Pass claimed'
                                : `Reserved until ${new Date(item.expires_at).toLocaleDateString()}`}
                        </small>
                      </div>
                      {item.status === 'accepted' ? (
                        <span
                          className={`access-accepted${item.connected_at ? ' is-connected' : ''}`}
                        >
                          <Check size={16} /> {item.connected_at ? 'Connected' : 'Accepted'}
                        </span>
                      ) : (
                        <div className="access-invite-actions">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => change(item.id, 'resend')}
                          >
                            Resend
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => change(item.id, 'revoke')}
                          >
                            Withdraw
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <div id="desktops">
            <ConnectedDesktops />
          </div>
        </>
      ) : (
        <section className="access-card access-entry">
          <p>
            Still waiting? <a href="/waitlist/">Check your place & referrals</a>.
          </p>
          {token ? (
            <>
              <h2>Confirm sign-in</h2>
              <p>Verify your email to access downloads and passes. Keep this link private.</p>
              <p className="access-fine">
                By continuing, you confirm you’re 18 or older and agree to the{' '}
                <a href="/terms/">Terms</a>. See our <a href="/privacy/">Privacy Policy</a>.
              </p>
              <div className="access-entry-actions">
                <button
                  className="button button-primary button-download"
                  disabled={busy}
                  type="button"
                  onClick={accept}
                >
                  {busy ? 'Opening…' : 'Continue to Jackalope'} <ArrowRight size={18} />
                </button>
                <button
                  className="text-link"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setToken('');
                    setError('');
                  }}
                >
                  Need a fresh link?
                </button>
              </div>
            </>
          ) : sent ? (
            <>
              <h2>Check your email</h2>
              <p>
                If this address has access or a valid invitation, you’ll receive a sign-in link.
                Check your inbox and spam folder.
              </p>
              <button className="text-link" type="button" onClick={() => setSent(false)}>
                Use another email or try again
              </button>
            </>
          ) : (
            <>
              {invite && (
                <div className="access-invite-welcome">
                  <p>
                    Jackalope brings your installed coding agents, isolated Git worktrees, and
                    review into one calm desktop workspace.
                  </p>
                  <ul>
                    <li>
                      <Check className="access-invite-check" size={16} /> Use your existing agent
                      accounts and local repositories
                    </li>
                    <li>
                      <Check className="access-invite-check" size={16} /> Keep parallel changes
                      separated until you review them
                    </li>
                    <li>
                      <Check className="access-invite-check" size={16} /> Inspect results before
                      integrating work
                    </li>
                  </ul>
                </div>
              )}
              <h2>{invite ? 'Claim your pass' : 'Sign in'}</h2>
              <p>
                {invite
                  ? 'Enter your email. Follow the link we send to claim your pass while a place is available.'
                  : 'Enter your approved or invited email address to receive a sign-in link.'}
              </p>
              {invite && available === false && (
                <p className="access-alert">
                  All passes on this link are claimed or reserved right now. You can still sign in
                  if you already have access, or <a href="/#newsletter">join the waitlist</a>.
                </p>
              )}
              <form onSubmit={signIn}>
                <label htmlFor="access-email">Email address</label>
                <input
                  id="access-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  maxLength={254}
                  placeholder="you@example.com"
                  readOnly={busy}
                />
                <div className="signup-honey" aria-hidden="true">
                  <label htmlFor="access-website">Leave this blank</label>
                  <input id="access-website" name="website" tabIndex={-1} autoComplete="off" />
                </div>
                <button
                  className="button button-primary button-download"
                  type="submit"
                  disabled={busy}
                >
                  {busy ? 'Sending…' : 'Send sign-in link'} <ArrowRight size={17} />
                </button>
              </form>
              {invite && (
                <small>
                  When you accept, the person who invited you can see your email address and whether
                  you request a download or connect a desktop. They cannot see your projects or task
                  activity.
                </small>
              )}
              <p className="access-fine">
                By requesting a link, you confirm you’re 18 or older and agree to the{' '}
                <a href="/terms/">Terms</a>. Signing in does not subscribe you to newsletters.{' '}
                <a href="/privacy/">Privacy</a>.
              </p>
              <a className="text-link" href="/#newsletter">
                Need access? Join the waitlist <ArrowRight size={14} />
              </a>
            </>
          )}
        </section>
      )}
    </main>
  );
}
