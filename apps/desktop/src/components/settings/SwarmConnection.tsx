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

/**
 * Connects the person's own Jackalope Swarm Worker for cross-machine agent coordination.
 * Swarm builds on Artifacts, so it stays hidden until Artifacts is connected unless a
 * Worker is already saved and needs a way to disconnect.
 */
export function SwarmConnection({ artifactsConnected }: { artifactsConnected: boolean }) {
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
  if (!status || (!artifactsConnected && !status.configured)) return null;
  return (
    <SettingGroup>
      <Setting
        title={
          <span className="inline-flex items-center gap-2">
            Jackalope Swarm <Badge variant="accent">Beta</Badge>
          </span>
        }
        description="Gives each agent on an Artifacts project its own fork and flags overlapping edits while they work, even across computers."
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
            Deploy the Worker in apps/swarm, then enter its URL and SWARM_TOKEN secret.
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
      )}
      {error && (
        <InlineNotice tone="error" className="mx-5 my-4">
          {error}
        </InlineNotice>
      )}
    </SettingGroup>
  );
}
