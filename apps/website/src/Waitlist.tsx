import { ArrowRight, Check, Copy, LogOut, Mail, RefreshCw, Share2 } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { DesktopConnection } from './DesktopConnection';
import { AccessRequestError, accessMessage, accessOrigin, accessRequest } from './access-api';
import { BrandMark } from './BrandMark';
import './access.css';
import './waitlist.css';

interface Place {
  email: string;
  status: 'waiting' | 'approved';
  position: number | null;
  referrals: number;
  pending: number;
  priorityDays: number;
  shareUrl: string;
}
const shareMessage =
  'Join me on the Jackalope waitlist. A cross-platform workspace for coding agents, with room for your projects, changes, and review.';

export function WaitlistPage() {
  const [place, setPlace] = useState<Place | null>(null);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const refreshPlace = useCallback(() => {
    void accessRequest<Place>('waitlist/me').then(setPlace).catch(() => undefined);
  }, []);
  useEffect(() => {
    const readLink = () => {
      const url = new URL(window.location.href);
      const raw = new URLSearchParams(url.hash.slice(1)).get('token');
      if (raw) {
        history.replaceState(null, '', url.pathname + url.search);
        if (/^[a-f0-9]{64}$/.test(raw)) setToken(raw);
        else setError('This link is incomplete. Request a fresh one below.');
      }
    };
    readLink();
    window.addEventListener('hashchange', readLink);
    const controller = new AbortController();
    if (accessOrigin)
      void accessRequest<Place>('waitlist/me', undefined, controller.signal)
        .then(setPlace)
        .catch((e) => {
          if (!controller.signal.aborted && !(e instanceof AccessRequestError && e.status === 401))
            setError(accessMessage(e));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
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
  async function verify() {
    await act(async () => {
      await accessRequest('waitlist/accept', { token });
      setToken('');
      setPlace(await accessRequest<Place>('waitlist/me'));
      setNotice('Email verified. Your place is ready.');
    });
  }
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await act(async () => {
      await accessRequest('waitlist/link', {
        email: String(data.get('email') || '').trim(),
        website: String(data.get('website') || ''),
      });
      setSent(true);
    });
  }
  async function share() {
    if (!place) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join the Jackalope waitlist',
          text: shareMessage,
          url: place.shareUrl,
        });
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError'))
          setError('Sharing didn’t open. Copy your link below.');
      }
    } else
      await act(async () => {
        await navigator.clipboard.writeText(`${shareMessage}\n\n${place.shareUrl}`);
        setNotice('Message and referral link copied.');
      });
  }
  return (
    <main id="main" className="access-page page-width waitlist-page">
      <header className="waitlist-heading">
        <BrandMark />
        <h1>
          {place?.status === 'approved'
            ? 'Your next chapter is open.'
            : 'A little closer to Jackalope.'}
        </h1>
        <p>Your place. Your people. Your next hop.</p>
      </header>
      {error && (
        <p className="access-alert" role="alert">
          {error}
        </p>
      )}
      <p className="access-notice" role="status">
        {notice}
      </p>
      {place?.status !== 'approved' && <DesktopConnection email={place?.email ?? null} waiting refreshMembership={refreshPlace} />}
      {loading ? (
        <p role="status">Finding your place…</p>
      ) : token ? (
        <section className="access-card access-entry">
          <h2>Make your place yours.</h2>
          <p>Confirm your email to see your number and start earning referral priority.</p>
          <button
            className="button button-primary"
            disabled={busy}
            onClick={() => void verify()}
            type="button"
          >
            {busy ? 'Confirming…' : 'Confirm email & see my place'}
            <ArrowRight size={18} />
          </button>
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => setToken('')}
            type="button"
          >
            Request a different link
          </button>
        </section>
      ) : place ? (
        <>
          <div className="access-identity">
            <span>{place.email}</span>
            <button
              className="text-link"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await accessRequest('waitlist/logout', {});
                  setPlace(null);
                  setSent(false);
                })
              }
              type="button"
            >
              Sign out
              <LogOut size={14} />
            </button>
          </div>
          {place.status === 'approved' ? (
            <section className="waitlist-approved access-card">
              <Check size={32} />
              <h2>You’re in. Bring five people.</h2>
              <p>
                Your wait is over. Open your member space for your Instant Access Passes, setup
                steps, and available downloads.
              </p>
              <a className="button button-primary" href="/access/#invitations">
                Open my passes
                <ArrowRight size={18} />
              </a>
            </section>
          ) : (
            <section className="queue-ticket" aria-label="Your waitlist position">
              <div className="queue-ticket-number">
                <span>Your place in line</span>
                <strong>#{place.position?.toLocaleString() ?? '—'}</strong>
                <span>Every good introduction brings you closer.</span>
              </div>
              <div className="queue-ticket-progress">
                <dl>
                  <div>
                    <dt>Verified referrals</dt>
                    <dd>{place.referrals.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Awaiting verification</dt>
                    <dd>{place.pending.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Days of priority earned</dt>
                    <dd>{place.priorityDays.toLocaleString()}</dd>
                  </div>
                </dl>
                <button
                  className="text-link"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      setPlace(await accessRequest<Place>('waitlist/me'));
                      setNotice('Your place is up to date.');
                    })
                  }
                >
                  <RefreshCw size={16} />
                  Refresh my place
                </button>
              </div>
            </section>
          )}
          <section className="access-card waitlist-sharing">
            <div>
              <h2>
                {place.status === 'approved'
                  ? 'Keep the door open.'
                  : 'Good company gets you closer.'}
              </h2>
              <p>
                {place.status === 'approved'
                  ? 'Keep sharing the waitlist with as many people as you like. Your referral total keeps growing, and your five Instant Access Passes stay separate.'
                  : 'Invite as many people to the waitlist as you like. Every new signup that verifies their email through your link earns you one day of priority.'}
              </p>
              <p className="access-fine">
                We rank signup time minus earned priority, with earlier signups breaking ties. Your
                number can move both ways as others refer or leave the queue. Priority improves your
                place; it doesn’t promise an access date.
              </p>
            </div>
            <div>
              <label htmlFor="waitlist-share">Your unlimited waitlist link</label>
              <input
                id="waitlist-share"
                value={place.shareUrl}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="waitlist-actions">
                <button
                  className="button button-primary"
                  onClick={() => void share()}
                  type="button"
                  disabled={busy}
                >
                  <Share2 size={18} />
                  Share the waitlist
                </button>
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await navigator.clipboard.writeText(place.shareUrl);
                      setNotice('Referral link copied.');
                    })
                  }
                  type="button"
                >
                  <Copy size={18} />
                  Copy link
                </button>
              </div>
              <small>
                Your link shares the waitlist, never your private sign-in. It keeps working after
                acceptance and uses none of your five passes.
              </small>
            </div>
          </section>
          <aside className="waitlist-next">
            <BrandMark />
            <div>
              <h2>
                {place.status === 'approved'
                  ? 'Five passes. A head start for your people.'
                  : 'On the other side: five passes.'}
              </h2>
              <p>
                Accepted members get five Instant Access Passes. Each lets one person skip the line
                after email verification. Unlimited waitlist referrals and your five passes are
                separate.
              </p>
            </div>
          </aside>
        </>
      ) : (
        <section className="access-card access-entry">
          <h2>{sent ? 'Check your inbox.' : 'Find your place.'}</h2>
          <p>
            {sent
              ? 'If this address is on the list, a private link is on its way. Check spam too. You can request another after a minute.'
              : 'Already joined? We’ll send you a private link to your position and referrals.'}
          </p>
          {accessOrigin ? (
            <form onSubmit={signIn}>
              <label htmlFor="waitlist-email">Email address</label>
              <input
                id="waitlist-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                disabled={busy}
              />
              <div className="signup-honeypot" aria-hidden="true">
                <label htmlFor="waitlist-website">Website</label>
                <input id="waitlist-website" name="website" tabIndex={-1} autoComplete="off" />
              </div>
              <button className="button button-primary" type="submit" disabled={busy}>
                {busy ? 'Sending…' : sent ? 'Send a fresh link' : 'Email my private link'}
                <Mail size={18} />
              </button>
            </form>
          ) : (
            <p>Waitlist status will be available when sign-in opens.</p>
          )}
          <p>
            New here? <a href="/#newsletter">Join the waitlist</a>. Already accepted?{' '}
            <a href="/access/">Open your member space</a>.
          </p>
        </section>
      )}
    </main>
  );
}
