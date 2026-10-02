import { Badge, Button, FormField, Input } from '@jackalope/ui';
import { useCallback, useEffect, useState } from 'react';
import {
  type SwarmConnection as Connection,
  removeSwarmConnection,
  saveSwarmConnection,
  swarmConnection,
} from '../../lib/swarm';
import { InlineNotice } from '../ui/InlineNotice';
import { Setting, SettingGroup } from './Setting';

/** Connects the person's own Jackalope Swarm Worker for cross-machine agent coordination. */
export function SwarmConnection() {
  const [status, setStatus] = useState<Connection | null>(null);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => setStatus(await swarmConnection()), []);
  useEffect(() => {
    void refresh().catch((cause) => setError(String(cause)));
  }, [refresh]);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingGroup>
      <Setting
        title={
          <span className="inline-flex items-center gap-2">
            Jackalope Swarm <Badge variant="accent">Beta</Badge>
          </span>
        }
        description="Gives every agent on an Artifacts project its own fork and checks them against each other in your Cloudflare Worker, so overlapping edits show up while agents work, even on different computers."
      />
      {status?.configured ? (
        <Setting title="Your swarm Worker" description={status.url}>
          <Button
            variant="outline"
            loading={busy}
            loadingLabel="Disconnecting…"
            disabled={busy}
            onClick={() => void act(removeSwarmConnection)}
          >
            Disconnect
          </Button>
        </Setting>
      ) : (
        status && (
          <form
            className="space-y-3 px-5 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              void act(async () => {
                await saveSwarmConnection(url.trim(), token.trim());
                setToken('');
              });
            }}
          >
            <p className="settings-row-description">
              Deploy apps/swarm to your Cloudflare account with wrangler, set its SWARM_TOKEN
              secret, then enter the Worker URL and that token here.
            </p>
            <FormField label="Worker URL">
              <Input
                required
                spellCheck={false}
                placeholder="https://jackalope-swarm.<you>.workers.dev"
                value={url}
                disabled={busy}
                onChange={(event) => setUrl(event.target.value)}
              />
            </FormField>
            <FormField label="Swarm token">
              <Input
                required
                type="password"
                autoComplete="off"
                value={token}
                disabled={busy}
                onChange={(event) => setToken(event.target.value)}
              />
            </FormField>
            <Button
              type="submit"
              loading={busy}
              loadingLabel="Checking…"
              disabled={busy || !url.trim() || !token.trim()}
            >
              Connect
            </Button>
          </form>
        )
      )}
      {error && (
        <InlineNotice tone="error" className="mx-5 my-4">
          {error}
        </InlineNotice>
      )}
    </SettingGroup>
  );
}
