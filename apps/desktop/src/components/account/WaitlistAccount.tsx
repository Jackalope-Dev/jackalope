import { CopyButton, FormField, Input } from '@jackalope/ui';
import { useEffect, useRef } from 'react';
import './waitlist.css';

export interface WaitlistProgress {
  position: number | null;
  referrals: number;
  pending: number;
  priorityDays: number;
  shareUrl: string;
  checkedAt: number;
}

export function WaitlistAccount({
  email,
  progress,
  offline,
}: {
  email: string | null;
  progress: WaitlistProgress;
  offline: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const message = `Join me on the Jackalope waitlist. A workspace for coding agents, projects, and reviewing their changes.\n\n${progress.shareUrl}`;
  return (
    <section className="desktop-waitlist" aria-labelledby="desktop-waitlist-heading">
      <header>
        <h2 id="desktop-waitlist-heading" ref={heading} tabIndex={-1}>
          You’re on the list.
        </h2>
        <p className="desktop-waitlist-email">{email}</p>
      </header>
      <div className="desktop-waitlist-place" role="status">
        <span>{offline ? 'Last known position' : 'Your place in line'}</span>
        <strong>
          {progress.position === null ? 'Pending' : `#${progress.position.toLocaleString()}`}
        </strong>
        <p>
          {progress.position === null
            ? 'Your position is not available yet. Check again shortly.'
            : 'We’re inviting people in stages. Your position may change as others join and refer friends.'}
        </p>
      </div>
      {offline && (
        <p role="status" className="desktop-waitlist-offline">
          Couldn’t refresh your access. Showing progress from{' '}
          {new Date(progress.checkedAt).toLocaleString()}. Reconnect to check for approval.
        </p>
      )}
      <div className="desktop-waitlist-sharing">
        <h3>Bring a friend. Move up the list.</h3>
        <p>
          Each new person who verifies their email through your link earns you one day of priority.
        </p>
        <p>
          <strong>{progress.referrals.toLocaleString()}</strong> verified{' '}
          {progress.referrals === 1 ? 'referral' : 'referrals'} ·{' '}
          <strong>{progress.priorityDays.toLocaleString()}</strong>{' '}
          {progress.priorityDays === 1 ? 'day' : 'days'} of priority
          {progress.pending > 0 && ` · ${progress.pending.toLocaleString()} awaiting verification`}
        </p>
        <FormField label="Your referral link">
          <Input
            id="desktop-waitlist-link"
            value={progress.shareUrl}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
        </FormField>
        <div className="desktop-waitlist-share-actions">
          <CopyButton text={progress.shareUrl} label="Copy link" variant="primary" />
          <CopyButton text={message} label="Copy share message" variant="outline" />
        </div>
      </div>
      <p className="desktop-waitlist-note">
        This app will continue automatically when your access is approved.
      </p>
    </section>
  );
}
