import { ArrowUpRight, Check, Copy, Mail, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { Button } from '../ui/button';

interface ReferralInvite {
  id: string;
  email: string;
  status: 'pending' | 'accepted';
  expiresAt: number;
  acceptedAt: number | null;
  downloadedAt: number | null;
  connectedAt: number | null;
}
interface ReferralView {
  limit: number;
  remaining: number;
  accepted: number;
  downloaded: number;
  connected: number;
  shareUrl: string;
  invites: ReferralInvite[];
}

const invitationMessage =
  'I’ve been trying Jackalope, a local desktop workspace for running coding agents in isolated Git worktrees and reviewing their changes. I have an early-access invitation if you want to try it.';

async function openExternal(url: string) {
  if (isTauriEnvironment()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } else window.open(url, '_blank', 'noopener,noreferrer');
}

export function ReferralSettings({ onAccount }: { onAccount: () => void }) {
  const [referrals, setReferrals] = useState<ReferralView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (!isTauriEnvironment()) throw new Error('Open the Windows app to manage invitations.');
      setReferrals(await nativeTask<ReferralView>('app_account_referrals'));
    } catch (cause) {
      setReferrals(null);
      setError(typeof cause === 'string' ? cause : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
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
  if (loading)
    return (
      <p role="status" className="settings-row-description">
        Loading invitations…
      </p>
    );
  if (!referrals)
    return (
      <div className="space-y-4">
        <p role="alert" className="settings-row-description">
          {error || 'Invitations are unavailable.'}
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
          <span>of {referrals.limit} invitations available</span>
        </div>
        <p>
          {referrals.accepted
            ? `${referrals.accepted} accepted · ${referrals.downloaded} downloaded · ${referrals.connected} connected`
            : 'Invite a developer who would enjoy working with local coding agents.'}
        </p>
      </div>
      <div className="referral-share">
        <label htmlFor="desktop-referral-link">Your invitation link</label>
        <div className="referral-link-row">
          <input
            id="desktop-referral-link"
            readOnly
            value={referrals.shareUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            disabled={!referrals.remaining}
            onClick={() => void copy(referrals.shareUrl, 'Invitation link copied.')}
          >
            <Copy size={16} /> Copy link
          </Button>
        </div>
        <div className="referral-actions">
          <Button
            variant="outline"
            disabled={!referrals.remaining}
            onClick={() =>
              void copy(
                `${invitationMessage}\n\n${referrals.shareUrl}`,
                'Invitation message copied.',
              )
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
            <h3>Invitation progress</h3>
            <button type="button" onClick={() => void load()} aria-label="Refresh invitations">
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
                          ? 'Invitation accepted'
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
        <p className="settings-row-description">No invitations sent yet.</p>
      )}
      <Button variant="outline" onClick={() => void openManagement()}>
        Manage email invitations <ArrowUpRight size={16} />
      </Button>
      {error && (
        <p role="alert" className="settings-row-description">
          {error}
        </p>
      )}
    </div>
  );
}
