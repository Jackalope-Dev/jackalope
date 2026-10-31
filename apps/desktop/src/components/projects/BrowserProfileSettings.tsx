import { FormField, Input } from '@jackalope/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type DesktopSiteDecision,
  desktopPermissions,
  forgetDesktopPermission,
} from '../../lib/agent-screen';
import {
  type BrowserProfileOwner,
  type BrowserProfileStatus,
  botSiteDecisionKey,
  browserProfileStatus,
  clearBrowserProfileSite,
  closeBrowserProfile,
  deleteBrowserProfile,
  openBrowserProfile,
  profileSize,
} from '../../lib/browser-profiles';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { Setting, SettingBody, SettingGroup } from '../settings/Setting';
import { Button } from '../ui/button';
import { ConfirmAction } from '../ui/ConfirmAction';
import { InlineNotice } from '../ui/InlineNotice';
import '../settings/settings.css';

function lastUsed(status: BrowserProfileStatus) {
  if (!status.lastUsedAt) return 'Not used yet';
  return `Last used ${new Date(status.lastUsedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
}

/**
 * The persistent agent browser of a project or bot: sign in once, see which
 * sites keep data, clear one site or delete the profile.
 */
export function BrowserProfileSettings({
  owner: { kind, id, name },
}: {
  owner: BrowserProfileOwner;
}) {
  const owner = useMemo(() => ({ kind, id, name }), [kind, id, name]);
  const [status, setStatus] = useState<BrowserProfileStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [decisions, setDecisions] = useState<DesktopSiteDecision[]>([]);
  const decisionKey = owner.kind === 'bot' ? botSiteDecisionKey(owner.id) : '';
  const label = owner.kind === 'bot' ? `${owner.name} browser` : 'project browser';

  const refresh = useCallback(async () => {
    if (!isTauriEnvironment()) return;
    try {
      setStatus(await browserProfileStatus({ kind, id, name: '' }));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoaded(true);
    }
  }, [kind, id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!decisionKey || !isTauriEnvironment()) return;
    let current = true;
    void desktopPermissions(decisionKey)
      .then((value) => current && setDecisions(value.sites))
      .catch(() => current && setDecisions([]));
    return () => {
      current = false;
    };
  }, [decisionKey]);

  // While the window or a task holds the profile, follow it until it is released.
  const held = !!status?.windowOpen || !!status?.inUse;
  useEffect(() => {
    if (!held) return;
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [held, refresh]);

  const run = async (key: string, action: () => Promise<BrowserProfileStatus | null>) => {
    setBusy(key);
    setError('');
    try {
      setStatus(await action());
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy('');
    }
  };

  const forget = async (id: string) => {
    setBusy(`decision:${id}`);
    setError('');
    try {
      await forgetDesktopPermission(decisionKey, id);
      setDecisions((items) => items.filter((item) => item.id !== id));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy('');
    }
  };

  const description =
    owner.kind === 'bot'
      ? `A separate browser profile only ${owner.name} uses, in any project. Sign in once and the bot stays signed in. Your everyday browser is never touched.`
      : 'A separate browser profile agents in this project can ask to use for signed-in work. Sign in once and later tasks stay signed in. Your everyday browser is never touched, and agents never see your passwords.';

  return (
    <SettingGroup title="Browser profiles" description={description}>
      {error && (
        <SettingBody>
          <InlineNotice tone="error">{error}</InlineNotice>
        </SettingBody>
      )}
      <Setting
        title={status?.name ?? (owner.kind === 'bot' ? `${owner.name} browser` : 'Project browser')}
        description={
          !loaded
            ? 'Loading…'
            : !status
              ? 'Not created yet. Opening it creates the profile.'
              : status.windowOpen
                ? 'Open for you to sign in. Close the window or choose Done when finished.'
                : status.inUse
                  ? `In use by ${status.inUse}. ${profileSize(status.sizeBytes)} on disk.`
                  : `${lastUsed(status)} · ${profileSize(status.sizeBytes)} on disk`
        }
      >
        {status?.windowOpen ? (
          <Button
            type="button"
            variant="outline"
            loading={busy === 'close'}
            loadingLabel="Closing…"
            disabled={!!busy}
            onClick={() => void run('close', () => closeBrowserProfile(status.id))}
          >
            Done signing in
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            loading={busy === 'open'}
            loadingLabel="Opening…"
            disabled={!!busy || !!status?.inUse || !isTauriEnvironment()}
            onClick={() => void run('open', () => openBrowserProfile(owner, url))}
          >
            Open {label} to sign in
          </Button>
        )}
      </Setting>
      {!status?.windowOpen && (
        <SettingBody>
          <FormField
            label="Start page"
            description="Optional. The window opens at this address, such as a site's sign-in page."
          >
            <Input
              type="url"
              value={url}
              placeholder="https://example.com/login"
              onChange={(event) => setUrl(event.target.value)}
            />
          </FormField>
        </SettingBody>
      )}
      {status && status.signedInSites.length === 0 && (
        <SettingBody>
          <p className="settings-section-subtitle">No sites have saved data in this profile yet.</p>
        </SettingBody>
      )}
      {status?.signedInSites.map((site) => (
        <Setting key={site} title={site} description="Has cookies or stored data in this profile.">
          <Button
            type="button"
            variant="outline"
            loading={busy === `site:${site}`}
            loadingLabel="Clearing…"
            disabled={!!busy || !!status.inUse}
            aria-label={`Clear site data for ${site}`}
            onClick={() => void run(`site:${site}`, () => clearBrowserProfileSite(status.id, site))}
          >
            Clear site data
          </Button>
        </Setting>
      ))}
      {decisions.map((site) => (
        <Setting
          key={site.id}
          title={site.host}
          description={
            site.allow ? `Always allowed for ${owner.name}.` : `Never allowed for ${owner.name}.`
          }
        >
          <Button
            type="button"
            variant="outline"
            loading={busy === `decision:${site.id}`}
            loadingLabel="Removing…"
            disabled={!!busy}
            aria-label={`Remove website decision for ${site.host}`}
            onClick={() => void forget(site.id)}
          >
            Remove
          </Button>
        </Setting>
      ))}
      {status && (
        <Setting
          title="Delete profile"
          description="Removes every sign-in, cookie and file this profile stored. Agents start signed out next time."
        >
          <ConfirmAction
            trigger={
              <Button type="button" variant="outline" disabled={!!busy || !!status.inUse}>
                Delete profile…
              </Button>
            }
            title={`Delete the ${status.name}?`}
            description="Every sign-in, cookie and stored file in this profile is removed. This cannot be undone."
            label="Delete profile"
            busyLabel="Deleting…"
            onConfirm={async () => {
              setError('');
              try {
                await deleteBrowserProfile(status.id);
                setStatus(null);
              } catch (cause) {
                setError(String(cause));
              }
            }}
          />
        </Setting>
      )}
    </SettingGroup>
  );
}
