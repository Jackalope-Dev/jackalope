import {
  Badge,
  Button,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  FormField,
  Input,
  LinkButton,
  Select,
  SelectItem,
} from '@jackalope/ui';
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
import { SwarmConnection } from './SwarmConnection';
import './artifacts-connection.css';

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

/** Cloudflare account IDs are 32 hex characters and appear in every dashboard link. */
const accountIdIn = (value: string) => value.match(/[0-9a-f]{32}/i)?.[0] ?? value.trim();

/**
 * Connects a bring-your-own Cloudflare account. Connect Cloudflare signs in through
 * the browser and finishes on its own when only one account was shared; an API token
 * remains available for accounts or policies that need it.
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
  const finish = async (accountId: string) =>
    onConnected(
      await connectCloudflareAccount({
        accountId,
        namespace: namespace.trim() || 'jackalope',
        jurisdiction,
      }),
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
      const only = accounts.length === 1 ? accounts[0] : undefined;
      if (only) {
        try {
          await finish(only.id);
          return;
        } catch (cause) {
          setError(String(cause));
        }
      }
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
    <Disclosure className="artifacts-advanced">
      <DisclosureSummary>Namespace and data location</DisclosureSummary>
      <DisclosureBody className="space-y-3">
        <FormField label="Namespace" description="Groups the repositories Jackalope creates.">
          <Input
            spellCheck={false}
            placeholder="jackalope"
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
      </DisclosureBody>
    </Disclosure>
  );
  if (stage.kind === 'start' || stage.kind === 'waiting')
    return (
      <div className={className}>
        <p className="settings-row-description">
          Needs a Cloudflare account on the Workers Paid plan, which Cloudflare bills for Artifacts
          usage.
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
            <LinkButton external onClick={() => open(stage.url)}>
              Open the sign-in page again
            </LinkButton>
          </InlineNotice>
        ) : (
          <div className="artifacts-connect-actions">
            <Button type="button" disabled={busy || disabled} onClick={() => void signIn()}>
              <CloudIcon size={16} aria-hidden="true" />
              Connect Cloudflare
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || disabled}
              onClick={() => {
                setError('');
                setStage({ kind: 'token' });
              }}
            >
              Use an API token
            </Button>
            <LinkButton
              external
              className="artifacts-docs-link"
              onClick={() => open(ARTIFACTS_DOCS_URL)}
            >
              Artifacts docs
            </LinkButton>
          </div>
        )}
        {stage.kind === 'start' && fields}
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
            await finish(stage.accountId);
          } catch (cause) {
            setError(String(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="settings-row-description">
          Signed in. Choose the account for your repositories.
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
            disabled={busy || disabled || !stage.accountId}
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
            accountId: accountIdIn(accountId),
            namespace: namespace.trim() || 'jackalope',
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
      <FormField label="Account ID" description="Or paste any dashboard link for the account.">
        <Input
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="32-character account ID"
          value={accountId}
          disabled={busy || disabled}
          maxLength={2048}
          onChange={(event) => setAccountId(accountIdIn(event.target.value))}
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
          disabled={busy || disabled || !accountId.trim() || !token.trim()}
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
          description="Create projects on Artifacts, or move an existing repository there from Project settings."
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
      {status && <SwarmConnection artifactsConnected={status.connected} />}
      <SettingGroup aria-disabled="true">
        <Setting
          title={
            <span className="inline-flex items-center gap-2">
              Jackalope Cloud <Badge>Coming soon</Badge>
            </span>
          }
          description="Hosted Artifacts without a Cloudflare account, with shared review links and checks that run when agents push."
        />
      </SettingGroup>
    </>
  );
}
