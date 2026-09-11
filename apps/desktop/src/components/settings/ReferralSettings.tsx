import { PassTickets } from '@jackalope/brand/passes';
import { CopyButton, Input } from '@jackalope/ui';
import { ArrowUpRight, Check, Mail, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useMascotStore } from '../../stores/mascotStore';
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
  const [copiedPass, setCopiedPass] = useState<{ number: number } | null>(null);
  useEffect(() => {
    if (!copiedPass) return;
    const timer = window.setTimeout(() => setCopiedPass(null), 3500);
    return () => window.clearTimeout(timer);
  }, [copiedPass]);
  useEffect(() => {
    void load(false);
  }, [load]);
  const copy = async (value: string, success: string, passNumber?: number) => {
    try {
      await navigator.clipboard.writeText(value);
      if (passNumber !== undefined) setCopiedPass({ number: passNumber });
      useMascotStore.getState().say(success, 3500);
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
        {referrals.accepted > 0 && (
          <p>
            {referrals.accepted} accepted · {referrals.downloaded} downloaded ·{' '}
            {referrals.connected} connected
          </p>
        )}
      </div>
      <PassTickets
        {...referrals}
        actionLabel="Copy pass link"
        copiedPass={copiedPass?.number}
        onSelect={(number) => void copy(referrals.shareUrl, 'Pass link copied.', number)}
      />
      <p className="settings-row-description">
        Each pass lets one person skip the waitlist. These are separate from unlimited waitlist
        referrals.
      </p>
      <div className="referral-share">
        <label htmlFor="desktop-referral-link">Your pass link</label>
        <div className="referral-link-row">
          <Input
            id="desktop-referral-link"
            readOnly
            value={referrals.shareUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
          <CopyButton
            variant="primary"
            disabled={!referrals.remaining}
            text={referrals.shareUrl}
            label="Copy link"
            onCopied={() => useMascotStore.getState().say('Pass link copied.', 3500)}
          />
        </div>
        <div className="referral-actions">
          <CopyButton
            variant="outline"
            disabled={!referrals.remaining}
            text={`${invitationMessage}\n\n${referrals.shareUrl}`}
            label="Copy message"
            onCopied={() => useMascotStore.getState().say('Pass message copied.', 3500)}
          />
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
      {referrals.invites.length > 0 && (
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
