import { type FormEvent, useEffect, useRef, useState } from 'react';
import { AccessRequestError, accessRequest } from './access-api';
import './access.css';
import './feedback.css';

type Status = { completed: boolean; unsubscribed: boolean };
export function FeedbackPage() {
  const [token, setToken] = useState('');
  const [unsubscribe, setUnsubscribe] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const id = useRef('');
  const draft = useRef('');
  const tokenRef = useRef('');
  useEffect(() => {
    let controller: AbortController | undefined;
    const load = () => {
      controller?.abort();
      const fragment = new URLSearchParams(location.hash.slice(1));
      const value = fragment.get('token') ?? fragment.get('unsubscribe') ?? tokenRef.current;
      if (value !== tokenRef.current) {
        setMessage('');
        setPreview(false);
        id.current = '';
        draft.current = '';
      }
      tokenRef.current = value;
      setToken(value);
      setStatus(null);
      setError('');
      if (fragment.has('unsubscribe')) setUnsubscribe(true);
      else if (fragment.has('token')) setUnsubscribe(false);
      history.replaceState(null, '', location.pathname);
      if (!/^[a-f0-9]{64}$/.test(value)) {
        setError(
          'Open the private link in your feedback invitation. You can also send feedback from the app’s Updates & support settings.',
        );
        return;
      }
      controller = new AbortController();
      const signal = controller.signal;
      void accessRequest<Status>('feedback', { action: 'status', token: value }, signal)
        .then((result) => {
          if (!signal.aborted) setStatus(result);
        })
        .catch((cause) => {
          if (!signal.aborted) setError(feedbackError(cause));
        });
    };
    load();
    window.addEventListener('hashchange', load);
    return () => {
      controller?.abort();
      window.removeEventListener('hashchange', load);
    };
  }, []);
  const act = async (action: 'status' | 'submit' | 'unsubscribe') => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (action === 'submit' && draft.current !== message.trim()) {
        id.current = crypto.randomUUID();
        draft.current = message.trim();
      }
      const result = await accessRequest<Status>('feedback', {
        action,
        token,
        ...(action === 'submit' ? { id: id.current, message: draft.current } : {}),
      });
      if (tokenRef.current !== token) return;
      setStatus(result);
      if (action === 'submit') {
        setMessage('');
        setPreview(false);
      }
    } catch (cause) {
      setError(feedbackError(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const review = (event: FormEvent) => {
    event.preventDefault();
    if (message.trim()) setPreview(true);
  };
  return (
    <main id="main" className="feedback-page">
      <h1>
        {unsubscribe
          ? 'Feedback emails are your choice.'
          : status?.completed
            ? 'Thanks for helping shape Jackalope.'
            : 'What’s useful? What could feel better?'}
      </h1>
      {unsubscribe ? (
        status?.unsubscribed ? (
          <p role="status">
            Feedback emails are off. Your access and sign-in emails are unchanged.
          </p>
        ) : (
          <>
            <p>
              Stop feedback emails without changing your early access. You can still share thoughts
              whenever you want.
            </p>
            <button
              type="button"
              className="button button-primary"
              disabled={busy || !status}
              onClick={() => void act('unsubscribe')}
            >
              Stop feedback emails
            </button>
          </>
        )
      ) : status?.completed ? (
        <p role="status">
          Your thoughts are in our private inbox. We won’t send reminders or show more invitations
          for this round.
        </p>
      ) : status ? (
        <form onSubmit={review} className="feedback-form">
          <p>
            A sentence or two is plenty. Tell us how Jackalope fits into your workflow, including
            anything that got in your way.
          </p>
          {preview ? (
            <>
              <h2>Review your feedback</h2>
              <p className="feedback-preview">{message.trim()}</p>
              <div className="feedback-actions">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={busy}
                  onClick={() => void act('submit')}
                >
                  {busy ? 'Sending…' : 'Send to Jackalope'}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => setPreview(false)}
                >
                  Edit message
                </button>
              </div>
            </>
          ) : (
            <>
              <label htmlFor="feedback-message">What would you like us to know?</label>
              <textarea
                id="feedback-message"
                rows={6}
                maxLength={8000}
                required
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="What helped, what got in your way, or what you’d change…"
              />
              <p className="feedback-disclosure">
                We use this private link to record that you responded and stop further invitations.
                Only your message goes into the feedback inbox; include contact details if you’d
                like a reply. Please leave out secrets and private code.
              </p>
              <button
                type="submit"
                className="button button-primary"
                disabled={busy || !message.trim()}
              >
                Review feedback
              </button>
            </>
          )}
          {status.unsubscribed ? (
            <p className="feedback-disclosure">
              Feedback emails are off. You can still submit your thoughts here.
            </p>
          ) : (
            <button
              type="button"
              className="feedback-optout"
              disabled={busy}
              onClick={() => setUnsubscribe(true)}
            >
              Stop feedback emails
            </button>
          )}
        </form>
      ) : (
        !error && <p role="status">Opening your invitation…</p>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          {/^[a-f0-9]{64}$/.test(token) && (
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => void act('status')}
            >
              Retry
            </button>
          )}
        </div>
      )}
    </main>
  );
}
function feedbackError(error: unknown) {
  if (error instanceof AccessRequestError && error.status === 410)
    return 'This private link has expired. You can still send feedback from the app’s Updates & support settings.';
  if (error instanceof AccessRequestError && error.status === 429)
    return 'Please wait a minute before trying again. Your draft is still here.';
  return 'We couldn’t complete that request. Your draft is still here; please retry.';
}
