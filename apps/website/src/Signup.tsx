import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, Check, LoaderCircle, Mail, X } from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { signupActions } from './signup-config';

export function Signup({ popup = false }: { popup?: boolean }) {
  const id = useId();
  const [state, setState] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const action = popup ? signupActions.popup : signupActions.inline;
  async function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const controller = new AbortController();
    request.current = controller;
    setState('sending');
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new URLSearchParams({
          email: String(data.get('email') || '').trim(),
          website: String(data.get('website') || ''),
        }),
        signal: controller.signal,
        credentials: 'omit',
      });
      const result = await response.json();
      if (!response.ok || result.success !== true) {
        setMessage(
          response.status === 429
            ? 'A few too many attempts. Please wait a moment and try again.'
            : 'We could not subscribe this address. Check your email and try again.',
        );
        setState('error');
        return;
      }
      setState('success');
      setMessage(
        result.optIn?.required
          ? 'Check your inbox to confirm your email and finish joining the list.'
          : 'Thanks for making room for Jackalope. Watch your inbox for launch news and occasional product notes.',
      );
      form.reset();
    } catch {
      setMessage('The connection did not go through. Please try again in a moment.');
      setState('error');
    } finally {
      clearTimeout(timeout);
      request.current = null;
    }
  }
  return (
    <div className="signup">
      {state === 'success' ? (
        <div className="signup-success" role="status" aria-live="polite">
          <Check size={24} />
          <div>
            <h3>You’re on your way.</h3>
            <p>{message}</p>
          </div>
        </div>
      ) : (
        <form
          action={action}
          method="post"
          onSubmit={subscribe}
          aria-label="Join the Jackalope waitlist"
        >
          <label htmlFor={`${id}-email`}>Email address</label>
          <div className="signup-fields">
            <input
              id={`${id}-email`}
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              maxLength={254}
              aria-describedby={`${id}-consent`}
              readOnly={state === 'sending'}
            />
            <div className="signup-honey" aria-hidden="true">
              <label htmlFor={`${id}-website`}>Leave this field blank</label>
              <input
                id={`${id}-website`}
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
              />
            </div>
            <button
              className="button button-primary button-download"
              type="submit"
              disabled={state === 'sending'}
            >
              <span>{state === 'sending' ? 'Joining…' : 'Join the waitlist'}</span>
              {state === 'sending' ? (
                <LoaderCircle className="signup-spinner" size={17} />
              ) : (
                <ArrowRight size={17} />
              )}
            </button>
          </div>
          <p id={`${id}-consent`} className="signup-consent">
            By joining, you agree to receive Jackalope launch news and occasional product notes from
            Jackalope Digital LLC. Unsubscribe anytime. <a href="/privacy/">Privacy</a>.
          </p>
          {state === 'error' && (
            <p className="signup-error" role="alert">
              {message}
            </p>
          )}
        </form>
      )}
      <a
        className="signup-provider"
        href="https://www.sequenzy.com"
        target="_blank"
        rel="noreferrer"
      >
        Email by Sequenzy <ArrowRight size={11} />
      </a>
    </div>
  );
}

export function WaitlistButton({ compact = false, label }: { compact?: boolean; label?: string }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger
        className={`button button-primary button-download ${compact ? 'button-compact' : ''}`}
      >
        <span>{label || (compact ? 'Join waitlist' : 'Join the Windows waitlist')}</span>
        <ArrowRight size={16} />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="release-dialog waitlist-dialog">
          <Dialog.Close className="icon-button dialog-close" aria-label="Close waitlist">
            <X size={20} />
          </Dialog.Close>
          <Mail className="dialog-mark" size={32} />
          <Dialog.Title>Something good is taking shape.</Dialog.Title>
          <Dialog.Description>
            Be there when Jackalope is ready. Get the Windows launch announcement and occasional
            notes from the studio.
          </Dialog.Description>
          <Signup popup />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Newsletter() {
  return (
    <section className="newsletter page-width" aria-labelledby="newsletter-title">
      <div>
        <p className="eyebrow">LET’S KEEP IN TOUCH</p>
        <h2 id="newsletter-title">
          The next chapter,
          <br />
          in your inbox.
        </h2>
        <p>
          Windows launch news. Thoughtful product notes.
          <br />A little Jackalope, every now and then.
        </p>
      </div>
      <Signup />
    </section>
  );
}
