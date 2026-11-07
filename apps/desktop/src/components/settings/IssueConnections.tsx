import {
  Button,
  FormField,
  InlineNotice,
  Input,
  Select,
  SelectItem,
  SettingGroup,
  SettingRow,
} from '@jackalope/ui';
import { useCallback, useEffect, useState } from 'react';
import { openExternalUrl } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';

export function IssueConnections() {
  const [connections, setConnections] = useState<
    { provider: string; site: string; email: string }[]
  >([]);
  const [loaded, setLoaded] = useState(false);
  const [provider, setProvider] = useState('linear');
  const [site, setSite] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setConnections(await invokeNative('issue_connections'));
    setLoaded(true);
  }, []);
  useEffect(() => {
    void refresh().catch((cause) => setError(String(cause)));
  }, [refresh]);
  return (
    <SettingGroup title="Connected work">
      <SettingRow title="GitHub" description="Uses your GitHub CLI sign-in (gh auth login)." />
      {connections.map((connection) => (
        <SettingRow
          key={connection.provider}
          title={connection.provider === 'linear' ? 'Linear' : 'Jira'}
          description={connection.site || 'Connected'}
        >
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await invokeNative('issue_connection_remove', { provider: connection.provider });
                await refresh();
              } catch (cause) {
                setError(String(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            Disconnect
          </Button>
        </SettingRow>
      ))}
      <form
        className="space-y-3 px-5 py-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            await invokeNative('issue_connection_save', {
              connection: { provider, site: site.trim(), email: email.trim(), token: token.trim() },
            });
            setToken('');
            await refresh();
          } catch (cause) {
            setError(String(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <FormField label="Service">
          <Select
            value={provider}
            disabled={busy}
            onValueChange={(value) => {
              setProvider(value);
              setToken('');
            }}
          >
            <SelectItem value="linear">Linear</SelectItem>
            <SelectItem value="jira">Jira Cloud</SelectItem>
          </Select>
        </FormField>
        {provider === 'jira' && (
          <>
            <FormField label="Site">
              <Input
                required
                type="url"
                placeholder="https://team.atlassian.net"
                value={site}
                disabled={busy}
                onChange={(event) => setSite(event.target.value)}
              />
            </FormField>
            <FormField label="Account email">
              <Input
                required
                type="email"
                value={email}
                disabled={busy}
                onChange={(event) => setEmail(event.target.value)}
              />
            </FormField>
          </>
        )}
        <FormField label="API token">
          <Input
            required
            type="password"
            autoComplete="off"
            value={token}
            disabled={busy}
            maxLength={8192}
            onChange={(event) => setToken(event.target.value)}
          />
        </FormField>
        <div className="flex gap-2">
          <Button
            type="submit"
            loading={busy}
            loadingLabel="Connecting…"
            disabled={busy || !loaded || !token.trim()}
          >
            Connect
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void openExternalUrl(
                provider === 'linear'
                  ? 'https://linear.app/settings/api'
                  : 'https://id.atlassian.com/manage-profile/security/api-tokens',
              ).catch((cause) => setError(String(cause)))
            }
          >
            Create API token
          </Button>
        </div>
      </form>
      {error && (
        <InlineNotice tone="error" className="mx-5 my-4">
          {error}
          {!loaded && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void refresh()
                  .then(() => setError(''))
                  .catch((cause) => setError(String(cause)))
              }
            >
              Retry
            </Button>
          )}
        </InlineNotice>
      )}
    </SettingGroup>
  );
}
