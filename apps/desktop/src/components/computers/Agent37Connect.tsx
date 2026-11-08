import { describeError } from '@jackalope/contracts/errors';
import {
  Badge,
  Button,
  FormField,
  InlineNotice,
  Input,
  SettingBody,
  SettingGroup,
  SettingRow,
} from '@jackalope/ui';
import { useEffect, useState } from 'react';
import { agent37Status, agent37Usage, setAgent37Key } from '../../lib/computers';
import { isTauriEnvironment, openExternalUrl } from '../../lib/native/env';
import { ActionError } from '../ui/ActionError';

const KEYS_URL = 'https://www.agent37.com/';

/** Whether an Agent37 key is saved, kept current after connecting. */
export function useAgent37() {
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    void agent37Status()
      .then((status) => setConnected(status.connected))
      .catch(() => setConnected(false));
  }, []);
  return [connected, setConnected] as const;
}

/** Paste-and-connect for an Agent37 API key, checked with Agent37 before saving. */
export function Agent37KeyForm({
  onConnected,
  beta = false,
}: {
  onConnected: () => void;
  /** Marks Agent37 as a beta feature where no heading already does. */
  beta?: boolean;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        void setAgent37Key(key)
          .then(() => {
            setKey('');
            onConnected();
          })
          .catch((cause) => setError(describeError(cause)))
          .finally(() => setBusy(false));
      }}
    >
      <FormField
        label={
          beta ? (
            <span className="inline-flex items-center gap-2">
              Agent37 API key <Badge variant="accent">Beta</Badge>
            </span>
          ) : (
            'Agent37 API key'
          )
        }
        description="Computers run and bill on your own Agent37 account."
      >
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk_live_…"
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
      </FormField>
      <ActionError error={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} loadingLabel="Connecting…" disabled={!key.trim()}>
          Connect
        </Button>
        <Button type="button" variant="outline" onClick={() => void openExternalUrl(KEYS_URL)}>
          Open Agent37
        </Button>
      </div>
    </form>
  );
}

/** Settings → Computers: the Agent37 connection and this month's spend. */
export function Agent37Settings() {
  const [connected, setConnected] = useAgent37();
  const [spend, setSpend] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!connected) return;
    void agent37Usage()
      .then((usage) => setSpend(usage.total))
      .catch(() => setSpend(null));
  }, [connected]);

  return (
    <SettingGroup
      title={
        <span className="inline-flex items-center gap-2">
          Agent37 <Badge variant="accent">Beta</Badge>
        </span>
      }
    >
      {connected ? (
        <SettingRow
          title={
            <span className="inline-flex items-center gap-2">
              Agent37 <Badge variant="accent">Connected</Badge>
            </span>
          }
          description={
            spend === null
              ? 'Computers bill to your Agent37 balance.'
              : `$${spend.toFixed(2)} this month`
          }
        >
          <Button
            variant="outline"
            loading={busy}
            loadingLabel="Disconnecting…"
            onClick={() => {
              setBusy(true);
              setError('');
              void setAgent37Key(null)
                .then(() => setConnected(false))
                .catch((cause) => setError(describeError(cause)))
                .finally(() => setBusy(false));
            }}
          >
            Disconnect
          </Button>
        </SettingRow>
      ) : (
        <SettingBody>
          <Agent37KeyForm onConnected={() => setConnected(true)} />
        </SettingBody>
      )}
      {error && (
        <SettingBody>
          <InlineNotice tone="error">{error}</InlineNotice>
        </SettingBody>
      )}
    </SettingGroup>
  );
}
