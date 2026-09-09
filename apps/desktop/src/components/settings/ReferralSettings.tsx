import { ArrowUpRight, Check, Copy, Mail, RefreshCw, Ticket } from 'lucide-react';
import { useEffect, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useReferralStore } from '../../stores/referralStore';
import { Button } from '../ui/button';
import { LoadingState } from '../ui/LoadingState';

const invitationMessage =
  'I’ve been trying Jackalope, a local desktop workspace for running coding agents in isolated Git worktrees and reviewing their changes. I have an Instant Access Pass for you to skip the waitlist after email verification, while a pass is available.';

async function openExternal(url: string) {
  if (isTauriEnvironment()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } else window.open(url, '_blank', 'noopener,noreferrer');
}

export function ReferralSettings({ onAccount }: { onAccount: () => void }) {
  const { referrals, loading, error: fetchError, load } = useReferralStore();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    void load(false);
  }, [load]);
  const copy = async (value: string, success: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(success);
      setError('');
    } catch {
      setError('Could not copy to the clipboard. Select and copy the invitation link instead.');
    }
  };
  const share = async (target: 'email' | 'x' | 'linkedin' | 'bluesky') => {
    if (!referrals) return;
    const complete = `${invitationMessage}\n\n${referrals.shareUrl}`;
    const url =
      target === 'email'
        ? `mailto:?subject=${encodeURIComponent('Try Jackalope early access')}&body=${encodeURIComponent(complete)}`
        : target === 'x'
          ? `https://x.com/intent/post?text=${encodeURIComponent(complete)}`
          : target === 'linkedin'
            ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(referrals.shareUrl)}`
            : `https://bsky.app/intent/compose?text=${encodeURIComponent(complete)}`;
    try {
      await openExternal(url);
    } catch {
      setError('Could not open that sharing option. Copy the invitation message instead.');
    }
  };
  const openManagement = async () => {
    try {
      await nativeTask('app_account_open_referrals');
    } catch (cause) {
      setError(typeof cause === 'string' ? cause : 'Could not open invitation management.');
    }
  };
  if (loading && !referrals) return <LoadingState label={'Loading passes…'} />;
  if (!referrals)
    return (
      <div className="space-y-4">
        <p role="alert" className="settings-row-description">
          {error || fetchError || 'Passes are unavailable.'}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={onAccount}>Open account settings</Button>
          <Button variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      </div>
    );
  return (
    <div className="referral-settings">
      <div className="referral-summary">
        <div>
          <strong>{referrals.remaining}</strong>
          <span>of {referrals.limit} Instant Access Passes available</span>
        </div>
        <p>
          {referrals.accepted
            ? `${referrals.accepted} accepted · ${referrals.downloaded} downloaded · ${referrals.connected} connected`
            : 'Invite a developer who would enjoy working with local coding agents.'}
        </p>
      </div>
      <ol className="desktop-pass-strip" aria-label="Instant Access Pass allowance">
        {Array.from({ length: Math.min(referrals.limit, 100) }, (_, index) => index + 1).map(
          (passNumber) => {
            const state =
              passNumber <= referrals.accepted
                ? 'Claimed'
                : passNumber <= referrals.limit - referrals.remaining
                  ? 'Reserved'
                  : 'Available';
            return (
              <li key={passNumber} data-state={state}>
                <Ticket size={24} />
                <strong>Pass {passNumber}</strong>
                <span>{state}</span>
              </li>
            );
          },
        )}
      </ol>
      <p className="settings-row-description">
        Each pass lets one person skip the waitlist. These are separate from unlimited waitlist
        referrals.
      </p>
      <div className="referral-share">
        <label htmlFor="desktop-referral-link">Your pass link</label>
        <div className="referral-link-row">
          <input
            id="desktop-referral-link"
            readOnly
            value={referrals.shareUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            disabled={!referrals.remaining}
            onClick={() => void copy(referrals.shareUrl, 'Pass link copied.')}
          >
            <Copy size={16} /> Copy link
          </Button>
        </div>
        <div className="referral-actions">
          <Button
            variant="outline"
            disabled={!referrals.remaining}
            onClick={() =>
              void copy(`${invitationMessage}\n\n${referrals.shareUrl}`, 'Pass message copied.')
            }
          >
            <Copy size={16} /> Copy message
          </Button>
          <Button
            variant="outline"
            disabled={!referrals.remaining}
            onClick={() => void share('email')}
          >
            <Mail size={16} /> Email
          </Button>
          <Button variant="outline" disabled={!referrals.remaining} onClick={() => void share('x')}>
            X
          </Button>
          <Button
            variant="outline"
            disabled={!referrals.remaining}
            onClick={() => void share('linkedin')}
          >
            LinkedIn
          </Button>
          <Button
            variant="outline"
            disabled={!referrals.remaining}
            onClick={() => void share('bluesky')}
          >
            Bluesky
          </Button>
        </div>
      </div>
      <p className="settings-row-description referral-disclosure">
        Places are claimed after email verification. You can see who accepts and whether they
        connect a desktop; Jackalope does not share their projects or task activity.
      </p>
      <p className="settings-row-description referral-notice" role="status" aria-live="polite">
        {notice}
      </p>
      {referrals.invites.length ? (
        <div className="referral-progress">
          <div className="referral-progress-heading">
            <h3>Your people</h3>
            <button type="button" onClick={() => void load()} aria-label="Refresh passes">
              <RefreshCw size={15} /> Refresh
            </button>
          </div>
          <ul>
            {referrals.invites.map((invite) => (
              <li key={invite.id}>
                <div>
                  <strong>{invite.email}</strong>
                  <span>
                    {invite.connectedAt
                      ? 'Connected Jackalope'
                      : invite.downloadedAt
                        ? 'Opened the download'
                        : invite.status === 'accepted'
                          ? 'Pass claimed'
                          : `Reserved until ${new Date(invite.expiresAt).toLocaleDateString()}`}
                  </span>
                </div>
                {invite.connectedAt ? (
                  <span className="referral-state is-connected">
                    <Check size={15} /> Connected
                  </span>
                ) : invite.status === 'accepted' ? (
                  <span className="referral-state">
                    <Check size={15} /> {invite.downloadedAt ? 'Downloaded' : 'Accepted'}
                  </span>
                ) : (
                  <span className="referral-state">Pending</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="settings-row-description">Your passes are ready for good company.</p>
      )}
      <Button variant="outline" onClick={() => void openManagement()}>
        Manage email passes <ArrowUpRight size={16} />
      </Button>
      {error && (
        <p role="alert" className="settings-row-description">
          {error}
        </p>
      )}
    </div>
  );
}
