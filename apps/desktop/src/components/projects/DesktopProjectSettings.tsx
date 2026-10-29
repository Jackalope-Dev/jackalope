import { useEffect, useState } from 'react';
import {
  type DesktopSiteDecision,
  desktopPermissions,
  forgetDesktopPermission,
  type RememberedDesktopGrant,
} from '../../lib/agent-screen';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { Setting, SettingBody, SettingGroup } from '../settings/Setting';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

/** Remembered desktop-control grants and website decisions for one project, each removable. */
export function DesktopProjectSettings({ projectId }: { projectId: string }) {
  const [grants, setGrants] = useState<RememberedDesktopGrant[]>([]);
  const [sites, setSites] = useState<DesktopSiteDecision[]>([]);
  const [removing, setRemoving] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let current = true;
    setError('');
    void desktopPermissions(projectId)
      .then((value) => {
        if (!current) return;
        setGrants(value.grants);
        setSites(value.sites);
      })
      .catch((cause) => current && setError(String(cause)));
    return () => {
      current = false;
    };
  }, [projectId]);

  const remove = async (id: string) => {
    setRemoving(id);
    setError('');
    try {
      await forgetDesktopPermission(projectId, id);
      setGrants((items) => items.filter((item) => item.id !== id));
      setSites((items) => items.filter((item) => item.id !== id));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setRemoving('');
    }
  };

  const removeButton = (id: string, label: string) => (
    <Button
      variant="outline"
      loading={removing === id}
      loadingLabel="Removing…"
      disabled={!!removing}
      aria-label={`Remove ${label}`}
      onClick={() => void remove(id)}
    >
      Remove
    </Button>
  );

  return (
    <SettingGroup
      title="Desktop control"
      description="Apps and websites you chose to always allow, or never allow, when an agent controls your desktop in this project. Full desktop access is asked for every task."
    >
      {error && (
        <SettingBody>
          <InlineNotice tone="error">{error}</InlineNotice>
        </SettingBody>
      )}
      {grants.length === 0 && sites.length === 0 && !error && (
        <SettingBody>
          <p className="settings-section-subtitle">
            Nothing is remembered. Agents ask before using any window, app or website.
          </p>
        </SettingBody>
      )}
      {grants.map((grant) => (
        <Setting
          key={grant.id}
          title={grant.label}
          description={
            grant.scope === 'app'
              ? 'Always allowed: every window of this app.'
              : 'Always allowed: one window of this app at a time.'
          }
        >
          {removeButton(grant.id, grant.label)}
        </Setting>
      ))}
      {sites.map((site) => (
        <Setting
          key={site.id}
          title={site.host}
          description={
            site.allow
              ? 'Website always allowed in your browser.'
              : 'Website never allowed in your browser.'
          }
        >
          {removeButton(site.id, site.host)}
        </Setting>
      ))}
    </SettingGroup>
  );
}
