import { accessMessage, accessOrigin, accessRequest } from './access-api';
import './access.css';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, Check, GitBranch, Layers3, LoaderCircle, X } from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { BrandMark } from './BrandMark';
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
      const response = accessOrigin
        ? null
        : await fetch(action, {
            method: 'POST',
            headers: { Accept: 'application/json' },
            body: new URLSearchParams({
              email: String(data.get('email') || '').trim(),
              website: String(data.get('website') || ''),
            }),
            signal: controller.signal,
            credentials: 'omit',
          });
      const result = accessOrigin
        ? await accessRequest<{ success: boolean; optIn?: { required: boolean } }>(
            'waitlist',
            {
              email: String(data.get('email') || '').trim(),
              website: String(data.get('website') || ''),
              newsletter: data.get('newsletter') === 'on',
              source: popup ? 'popup' : 'inline',
            },
            controller.signal,
          )
        : await response?.json();
      if ((response && !response.ok) || result.success !== true) {
        setMessage(
          response?.status === 429
            ? 'A few too many attempts. Please wait a moment and try again.'
            : 'We could not subscribe this address. Check your email and try again.',
        );
        setState('error');
        return;
      }
      setState('success');
      setMessage(
        accessOrigin
          ? 'You’re on the waitlist. We’ll email you when your access is approved. If you opted into product notes, check your inbox for any confirmation steps.'
          : result.optIn?.required
            ? 'Check your inbox to confirm your email and finish joining the list.'
            : 'Thanks for making room for Jackalope. Watch your inbox for launch news and occasional product notes.',
      );
      form.reset();
    } catch (error) {
      setMessage(
        accessOrigin
          ? accessMessage(error)
          : 'The connection did not go through. Please try again in a moment.',
      );
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
            {accessOrigin ? (
              <>
                We’ll email you about your access request. Product notes are optional.{' '}
                <a href="/privacy/">Privacy</a>.
              </>
            ) : (
              <>
                By joining, you agree to receive Jackalope launch news and occasional product notes
                from Jackalope Digital LLC. Unsubscribe anytime. <a href="/privacy/">Privacy</a>.
              </>
            )}
          </p>
          {accessOrigin && (
            <label className="signup-newsletter">
              <input name="newsletter" type="checkbox" disabled={state === 'sending'} />
              <span>Also send me occasional Jackalope product notes. Unsubscribe anytime.</span>
            </label>
          )}
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
  const content = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root>
      <Dialog.Trigger
        className={`button button-primary button-download ${compact ? 'button-compact' : ''}`}
      >
        <span>{label || (compact ? 'Join waitlist' : 'Get early access')}</span>
        <ArrowRight size={16} />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="release-dialog waitlist-dialog"
          ref={content}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            content.current
              ?.querySelector<HTMLInputElement>('input[type="email"]')
              ?.focus({ preventScroll: true });
          }}
        >
          <Dialog.Close className="icon-button dialog-close" aria-label="Close waitlist">
            <X size={20} />
          </Dialog.Close>
          <div className="waitlist-art" aria-hidden="true">
            <span className="waitlist-orbit" />
            <span className="waitlist-orbit waitlist-orbit-inner" />
            <span className="waitlist-stamp">
              <BrandMark />
            </span>
            <span className="waitlist-art-note">
              A little structure.
              <br />A lot of possibility.
            </span>
            <span className="waitlist-art-label">JACKALOPE / EARLY DAYS</span>
          </div>
          <div className="waitlist-body">
            <Dialog.Title>Join the Jackalope waitlist</Dialog.Title>
            <Dialog.Description>
              Be there for your next big idea. Get access news as Jackalope opens up. Windows comes
              first, with macOS and Linux planned.
            </Dialog.Description>
            <ul className="waitlist-perks">
              <li>
                <Layers3 size={15} /> One home for your agents
              </li>
              <li>
                <GitBranch size={15} /> Built for local projects
              </li>
            </ul>
            <Signup popup />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Newsletter() {
  return (
    <section id="newsletter" className="newsletter page-width" aria-labelledby="newsletter-title">
      <div>
        <h2 id="newsletter-title">
          The next chapter,
          <br />
          in your inbox.
        </h2>
        <p>Get early-access news. Bring your next big idea.</p>
      </div>
      <Signup />
    </section>
  );
}
