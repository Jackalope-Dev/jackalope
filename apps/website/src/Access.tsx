import { characterPaths } from '@jackalope/brand/character';
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  Copy,
  LoaderCircle,
  LogOut,
  Mail,
  Sprout,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { AccessRequestError, accessMessage, accessOrigin, accessRequest } from './access-api';
import './access.css';

interface Invitation {
  id: string;
  email: string;
  status: string;
  expires_at: number;
  last_sent: number;
}
interface Membership {
  email: string;
  limit: number;
  remaining: number;
  shareUrl: string;
  invites: Invitation[];
  download: { url: string; bytes: number } | null;
}

export function AccessPage() {
  const reduced = useReducedMotion();
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
        } else setError('This link is incomplete. Request a fresh private link below.');
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
      setNotice('You’re in. Make yourself at home.');
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
        'Invitations requested. New reservations appear below; recent duplicate requests are limited.',
      );
    });
  }
  async function change(id: string, action: 'resend' | 'revoke') {
    await act(async () => {
      const updated = await accessRequest<Membership>('invites/change', { id, action });
      setMember((current) => (current ? { ...current, ...updated } : current));
      setNotice(
        action === 'resend'
          ? 'A fresh invitation was requested. Recent duplicate emails are limited.'
          : 'Invitation withdrawn. That place is available again.',
      );
    });
  }
  const mark = (
    <svg viewBox="38 3 105 117" fill="currentColor" aria-hidden="true">
      <path d={characterPaths.farEar} />
      <path d={characterPaths.nearEar} />
      <path d={characterPaths.antler} />
      <path d={characterPaths.head} />
    </svg>
  );
  return (
    <main id="main" className="access-page page-width">
      <motion.header
        className="access-heading"
        initial={false}
        animate={reduced ? {} : { y: [12, 0], opacity: [0.7, 1] }}
        transition={{ duration: 0.6 }}
      >
        <div className="access-mascot">
          {mark}
          <span aria-hidden="true" />
        </div>
        <p className="eyebrow">A LITTLE ROOM FOR BIG IDEAS</p>
        <h1>
          {member
            ? 'Make yourself at home.'
            : invite || token
              ? 'Good things are better shared.'
              : 'Your next chapter starts here.'}
        </h1>
        <p>
          {member
            ? 'Your Jackalope download, a few first steps, and room for your favorite people.'
            : 'One private link. Your own space to build. A few good people along for the ride.'}
        </p>
      </motion.header>
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
          <LoaderCircle className="signup-spinner" size={22} /> Opening your space…
        </div>
      ) : !accessOrigin ? (
        <section className="access-card access-entry">
          <h2>A little more room, soon.</h2>
          <p>
            Early access is being prepared. Join the waitlist and we’ll let you know when your
            invitation is ready.
          </p>
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
          <section className="access-card access-download">
            <div>
              <p className="eyebrow">YOUR WORKSPACE</p>
              <h2>Big ideas. Room to run.</h2>
              <p>
                Jackalope keeps your local projects, coding agents, and review together. Your
                desktop workspace stays local-first.
              </p>
              {member.download ? (
                <a
                  className="button button-primary button-download"
                  href={`${accessOrigin}/v1/access/download`}
                >
                  <span>Download for Windows</span>
                  <ArrowDownToLine size={18} />
                </a>
              ) : (
                <div className="access-release">
                  <Sprout size={22} />
                  <div>
                    <strong>Your access is ready. The build is taking shape.</strong>
                    <p>The Windows installer will appear here after release checks are complete.</p>
                  </div>
                </div>
              )}
              <small>Windows x64 first · Bring your own agents and subscriptions</small>
            </div>
            <ol className="access-steps">
              <li>
                <span>01</span>
                <div>
                  <h3>Make a little space.</h3>
                  <p>
                    Install Jackalope when your download is ready, then open a local Git project.
                  </p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <h3>Bring your agents.</h3>
                  <p>
                    Connect a supported, locally installed CLI and choose the account profile for
                    your work.
                  </p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <h3>Let the idea run.</h3>
                  <p>
                    Describe a task. Follow the attempt, inspect the changes, and decide what to
                    keep.
                  </p>
                </div>
              </li>
            </ol>
          </section>
          <section className="access-card access-invitations" aria-labelledby="invite-heading">
            <div className="access-invite-intro">
              <div>
                <p className="eyebrow">GOOD COMPANY, GOOD IDEAS</p>
                <h2 id="invite-heading">Leave room for your people.</h2>
                <p>
                  Bring up to {member.limit} people straight in. Every person who accepts gets five
                  invitations of their own.
                </p>
              </div>
              <div className="access-places">
                <strong>
                  {member.remaining}
                  <span>/{member.limit}</span>
                </strong>
                <small>places to share</small>
              </div>
            </div>
            <div className="access-invite-options">
              <div>
                <h3>
                  <Mail size={18} /> Make it personal.
                </h3>
                <p>
                  Email invitations reserve a place for seven days. Unclaimed places return to you.
                </p>
                <form onSubmit={sendInvites}>
                  <label htmlFor="invite-emails">Their email addresses</label>
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
                    Up to five addresses. Commas or new lines work.
                  </small>
                  <button
                    className="button button-primary button-download"
                    disabled={busy || member.remaining === 0}
                    type="submit"
                  >
                    Send invitations <ArrowRight size={17} />
                  </button>
                </form>
              </div>
              <div>
                <h3>
                  <Copy size={18} /> Let a link do the inviting.
                </h3>
                <p>
                  Send this link in a chat. A place is claimed when someone verifies their email.
                  When your places are gone, the link closes.
                </p>
                <label htmlFor="share-link">Your invitation link</label>
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
                      setNotice('Link copied. Send it to someone you’d love to build alongside.');
                    })
                  }
                >
                  <Copy size={16} /> Copy invitation link
                </button>
                <small>You’ll see the email address of people who accept your invitations.</small>
              </div>
            </div>
            {member.invites.length > 0 && (
              <div className="access-invite-list">
                <h3>Your circle, taking shape.</h3>
                <ul>
                  {member.invites.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.email}</strong>
                        <small>
                          {item.status === 'accepted'
                            ? 'Accepted · They’re in'
                            : `Reserved until ${new Date(item.expires_at).toLocaleDateString()}`}
                        </small>
                      </div>
                      {item.status === 'accepted' ? (
                        <span className="access-accepted">
                          <Check size={16} /> Accepted
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
        </>
      ) : (
        <section className="access-card access-entry">
          {token ? (
            <>
              <h2>Your space is one click away.</h2>
              <p>
                Continue to verify your email and open your downloads and invitations. Keep this
                private link to yourself.
              </p>
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
            </>
          ) : sent ? (
            <>
              <div className="access-mail-mark">
                <Mail size={28} />
              </div>
              <h2>A little note, on its way.</h2>
              <p>
                If this address has access or a valid invitation, you’ll receive a private link.
                Check your inbox and spam folder.
              </p>
              <button className="text-link" type="button" onClick={() => setSent(false)}>
                Use another email or try again
              </button>
            </>
          ) : (
            <>
              <h2>{invite ? 'You’ve been invited.' : 'Welcome back.'}</h2>
              <p>
                {invite
                  ? 'Enter your email to claim an available place. Your invitation is confirmed when you follow the link in your inbox.'
                  : 'Already approved or invited? Enter your email and we’ll send a private sign-in link.'}
              </p>
              {invite && available === false && (
                <p className="access-alert">
                  This invitation has no places available right now. You can still sign in if you
                  already have access, or <a href="/#newsletter">join the waitlist</a>.
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
                  {busy ? 'Sending…' : 'Send my private link'} <ArrowRight size={17} />
                </button>
              </form>
              {invite && (
                <small>
                  When you accept, the person who invited you can see your email address and
                  acceptance status.
                </small>
              )}
              <p className="access-fine">
                No password. No newsletter unless you choose it. <a href="/privacy/">Privacy</a>.
              </p>
              <a className="text-link" href="/#newsletter">
                New here? Join the waitlist <ArrowRight size={14} />
              </a>
            </>
          )}
        </section>
      )}
    </main>
  );
}
