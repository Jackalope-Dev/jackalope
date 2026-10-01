import { Badge, Button, FormField, Input, Select, SelectItem } from '@jackalope/ui';
import { Cloud as CloudIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ARTIFACTS_DOCS_URL,
  ARTIFACTS_TOKEN_URL,
  type ArtifactsJurisdiction,
  type ArtifactsStatus,
  artifactsStatus,
  beginCloudflareSignIn,
  type CloudflareAccount,
  cancelCloudflareSignIn,
  completeCloudflareSignIn,
  connectArtifacts,
  connectCloudflareAccount,
  disconnectArtifacts,
} from '../../lib/cloudflare-artifacts';
import { openExternalUrl } from '../../lib/tauri-bridge';
import { InlineNotice } from '../ui/InlineNotice';
import { Setting, SettingGroup } from './Setting';

export function ArtifactsTitle() {
  return (
    <span className="inline-flex items-center gap-2">
      Cloudflare Artifacts <Badge variant="accent">Beta</Badge>
    </span>
  );
}

type Stage =
  | { kind: 'start' }
  | { kind: 'waiting'; url: string }
  | { kind: 'choose'; accounts: CloudflareAccount[]; accountId: string }
  | { kind: 'token' };

/**
 * Connects a bring-your-own Cloudflare account. Connect Cloudflare signs in through
 * the browser; an API token remains available for accounts or policies that need it.
 */
export function ArtifactsConnectForm({
  onConnected,
  disabled = false,
  className = 'space-y-3 px-5 py-4',
}: {
  onConnected: (status: ArtifactsStatus) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'start' });
  const [accountId, setAccountId] = useState('');
  const [namespace, setNamespace] = useState('jackalope');
  const [jurisdiction, setJurisdiction] = useState<ArtifactsJurisdiction>('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const waiting = useRef(false);
  const open = (url: string) => void openExternalUrl(url).catch((cause) => setError(String(cause)));
  // Leaving the form abandons an unfinished browser sign-in and its listener.
  useEffect(
    () => () => {
      if (waiting.current) void cancelCloudflareSignIn().catch(() => {});
    },
    [],
  );
  const signIn = async () => {
    setError('');
    setBusy(true);
    try {
      const url = await beginCloudflareSignIn();
      setStage({ kind: 'waiting', url });
      waiting.current = true;
      await openExternalUrl(url);
      const accounts = await completeCloudflareSignIn();
      waiting.current = false;
      setStage({ kind: 'choose', accounts, accountId: accounts[0]?.id ?? '' });
    } catch (cause) {
      waiting.current = false;
      const message = String(cause);
      if (!message.includes('canceled')) setError(message);
      setStage({ kind: 'start' });
    } finally {
      setBusy(false);
    }
  };
  const fields = (
    <>
      <FormField label="Namespace" description="Groups the repositories Jackalope creates.">
        <Input
          required
          spellCheck={false}
          value={namespace}
          disabled={busy || disabled}
          maxLength={63}
          onChange={(event) => setNamespace(event.target.value)}
        />
      </FormField>
      <FormField
        label="Data location"
        description="Applies when Jackalope creates the namespace and cannot be changed later."
      >
        <Select
          value={jurisdiction || 'any'}
          disabled={busy || disabled}
          onValueChange={(value) =>
            setJurisdiction(value === 'any' ? '' : (value as ArtifactsJurisdiction))
          }
        >
          <SelectItem value="any">No restriction</SelectItem>
          <SelectItem value="eu">European Union</SelectItem>
          <SelectItem value="us">United States</SelectItem>
        </Select>
      </FormField>
    </>
  );
  if (stage.kind === 'start' || stage.kind === 'waiting')
    return (
      <div className={className}>
        <p className="settings-row-description">
          Uses your own Cloudflare account on the Workers Paid plan. Cloudflare bills Artifacts
          operations and storage to that account.
        </p>
        {stage.kind === 'waiting' ? (
          <InlineNotice
            action={
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  waiting.current = false;
                  void cancelCloudflareSignIn().catch(() => {});
                }}
              >
                Cancel
              </Button>
            }
          >
            Approve Jackalope in your browser, then return here.{' '}
            <button type="button" className="artifacts-link" onClick={() => open(stage.url)}>
              Open the sign-in page again
            </button>
          </InlineNotice>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy || disabled} onClick={() => void signIn()}>
              <CloudIcon size={16} aria-hidden="true" />
              Connect Cloudflare
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy || disabled}
              onClick={() => {
                setError('');
                setStage({ kind: 'token' });
              }}
            >
              Use an API token instead
            </Button>
            <Button type="button" variant="ghost" onClick={() => open(ARTIFACTS_DOCS_URL)}>
              Artifacts docs
            </Button>
          </div>
        )}
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
      </div>
    );
  if (stage.kind === 'choose')
    return (
      <form
        className={className}
        onSubmit={async (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            onConnected(
              await connectCloudflareAccount({
                accountId: stage.accountId,
                namespace: namespace.trim(),
                jurisdiction,
              }),
            );
          } catch (cause) {
            setError(String(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="settings-row-description">
          Signed in to Cloudflare. Choose where Jackalope keeps your repositories.
        </p>
        <FormField label="Cloudflare account">
          <Select
            value={stage.accountId}
            disabled={busy || disabled}
            onValueChange={(value) => setStage({ ...stage, accountId: value })}
          >
            {stage.accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))}
          </Select>
        </FormField>
        {fields}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            loading={busy}
            loadingLabel="Connecting…"
            disabled={busy || disabled || !stage.accountId || !namespace.trim()}
          >
            Finish connecting
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              void cancelCloudflareSignIn().catch(() => {});
              setStage({ kind: 'start' });
            }}
          >
            Start over
          </Button>
        </div>
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
      </form>
    );
  return (
    <form
      className={className}
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (busy) return;
        setBusy(true);
        setError('');
        try {
          const status = await connectArtifacts({
            accountId: accountId.trim(),
            namespace: namespace.trim(),
            jurisdiction,
            token: token.trim(),
          });
          setToken('');
          onConnected(status);
        } catch (cause) {
          setError(String(cause));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="settings-row-description">
        Create an API token with Account → Artifacts → Edit for the account you want to use.
      </p>
      <FormField label="Account ID">
        <Input
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="32-character account ID"
          value={accountId}
          disabled={busy || disabled}
          maxLength={32}
          onChange={(event) => setAccountId(event.target.value)}
        />
      </FormField>
      <FormField label="API token">
        <Input
          required
          type="password"
          autoComplete="off"
          value={token}
          disabled={busy || disabled}
          maxLength={8192}
          onChange={(event) => setToken(event.target.value)}
        />
      </FormField>
      {fields}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          loading={busy}
          loadingLabel="Connecting…"
          disabled={busy || disabled || !accountId.trim() || !token.trim() || !namespace.trim()}
        >
          Connect
        </Button>
        <Button type="button" variant="outline" onClick={() => open(ARTIFACTS_TOKEN_URL)}>
          Create API token
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setError('');
            setStage({ kind: 'start' });
          }}
        >
          Connect Cloudflare instead
        </Button>
      </div>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </form>
  );
}

export function ArtifactsConnection() {
  const [status, setStatus] = useState<ArtifactsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setStatus(await artifactsStatus());
  }, []);
  useEffect(() => {
    void refresh().catch((cause) => setError(String(cause)));
  }, [refresh]);
  return (
    <>
      <SettingGroup>
        <Setting
          title={<ArtifactsTitle />}
          description="Git-compatible repositories built for agents. Create projects on Artifacts or move an existing repository there from Project settings."
        />
        {status?.connected ? (
          <Setting
            title="Your Cloudflare account"
            description={`${status.method === 'oauth' ? 'Signed in with Cloudflare' : 'API token'} · Namespace ${status.namespace}${
              status.jurisdiction ? ` · ${status.jurisdiction.toUpperCase()} data location` : ''
            } · Account ${status.accountId?.slice(0, 8)}…`}
          >
            <Button
              variant="outline"
              loading={busy}
              loadingLabel="Disconnecting…"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await disconnectArtifacts();
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
          </Setting>
        ) : (
          status && <ArtifactsConnectForm onConnected={setStatus} />
        )}
        {error && (
          <InlineNotice tone="error" className="mx-5 my-4">
            {error}
          </InlineNotice>
        )}
      </SettingGroup>
      <SettingGroup aria-disabled="true">
        <Setting
          title={
            <span className="inline-flex items-center gap-2">
              Jackalope Cloud <Badge>Coming soon</Badge>
            </span>
          }
          description="Hosted Artifacts without a Cloudflare account, with shared review links and checks that run when agents push. Not available yet; connecting your own account is the supported option."
        />
      </SettingGroup>
    </>
  );
}
