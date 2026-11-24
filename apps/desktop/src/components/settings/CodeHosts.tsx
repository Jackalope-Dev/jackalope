import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  FormField,
  GitHubIcon,
  InlineNotice,
  Input,
  type SecretCheck,
  SecretField,
  Select,
  SelectItem,
  SettingGroup,
  SetupList,
  SetupSteps,
} from '@jackalope/ui';
import { GitMerge, GitPullRequestArrow, Plus, Server } from 'lucide-react';
import './setup-screens.css';
import { useCallback, useEffect, useState } from 'react';
import { forgetProjectHosts } from '../../hooks/useProjectHost';
import { openExternalUrl } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import {
  BITBUCKET_SCOPES,
  BITBUCKET_TOKEN_URL,
  type BitbucketConnection,
  type ConfiguredHost,
  type HostAccess,
} from '../../lib/source-control';
import { ActionError } from '../ui/ActionError';

const ACCESS_STATUS: Record<HostAccess['state'], string> = {
  ready: 'Signed in',
  unchecked: 'Not checked',
  missing: 'GitLab CLI not installed',
  signedOut: 'Not signed in',
  notConnected: 'Not connected',
  error: 'Could not check',
};

/** Advises on a pasted token's shape; the real check is connecting. */
const tokenCheck = (value: string): SecretCheck =>
  value.trim().startsWith('ATATT')
    ? { tone: 'ok', message: 'Looks like an Atlassian API token.' }
    : {
        tone: 'info',
        message: 'Atlassian API tokens usually start with ATATT. Connecting will check it.',
      };

/**
 * Where pull requests and merge requests are opened, followed and merged. GitHub and GitLab
 * use the person's own CLI sign-in; Bitbucket Cloud uses an API token kept in protected
 * storage. Self-managed GitLab and GitHub Enterprise hosts are named here so their remotes
 * are recognized.
 */
export function CodeHosts() {
  const [hosts, setHosts] = useState<ConfiguredHost[]>([]);
  const [bitbucket, setBitbucket] = useState<BitbucketConnection | null>(null);
  const [gitlab, setGitlab] = useState<Record<string, HostAccess>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState<'host' | 'bitbucket' | null>(null);

  const checkGitlab = useCallback(async (names: string[]) => {
    const results = await Promise.all(
      names.map(async (host) => {
        try {
          return [host, await invokeNative<HostAccess>('gitlab_cli_status', { host })] as const;
        } catch (cause) {
          return [host, { state: 'error', message: describeError(cause) } as HostAccess] as const;
        }
      }),
    );
    setGitlab((current) => ({ ...current, ...Object.fromEntries(results) }));
  }, []);

  const refresh = useCallback(async () => {
    const settings = await invokeNative<{
      hosts: ConfiguredHost[];
      bitbucket: BitbucketConnection | null;
    }>('source_control_settings');
    setHosts(settings.hosts);
    setBitbucket(settings.bitbucket);
    setLoaded(true);
    void checkGitlab([
      'gitlab.com',
      ...settings.hosts.filter((item) => item.kind === 'gitlab').map((item) => item.host),
    ]);
  }, [checkGitlab]);

  useEffect(() => {
    void refresh().catch((cause) => setError(describeError(cause)));
  }, [refresh]);

  const act = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      forgetProjectHosts();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const gitlabRow = (host: string) => {
    const access = gitlab[host];
    return {
      status: access ? ACCESS_STATUS[access.state] : 'Checking…',
      description: access?.message || undefined,
      actions: (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || !access}
          onClick={() => {
            setGitlab(({ [host]: _checked, ...rest }) => rest);
            void checkGitlab([host]);
          }}
        >
          Check again
        </Button>
      ),
    };
  };

  return (
    <SettingGroup
      title="Code hosts"
      description="Where Jackalope opens, follows and merges pull requests and merge requests."
    >
      <div className="settings-setup-body">
        <SetupList
          label="Code hosts"
          items={[
            {
              id: 'github',
              icon: <GitHubIcon size={16} />,
              title: 'GitHub',
              status: 'Uses the GitHub CLI',
              description: 'Signed in through gh auth login.',
            },
            {
              id: 'gitlab.com',
              icon: <GitMerge size={16} />,
              title: 'GitLab',
              ...gitlabRow('gitlab.com'),
            },
            {
              id: 'bitbucket',
              icon: <GitPullRequestArrow size={16} />,
              title: 'Bitbucket Cloud',
              status: bitbucket ? 'Connected' : 'Not connected',
              description: bitbucket
                ? [bitbucket.email, bitbucket.name].filter(Boolean).join(' · ')
                : 'Needs your Atlassian email and a Bitbucket API token.',
              actions: bitbucket ? (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const checked = await invokeNative<BitbucketConnection>(
                          'bitbucket_connection_test',
                        );
                        setBitbucket(checked);
                        setNotice(
                          `Bitbucket accepted the token for ${checked.name ?? checked.email}.`,
                        );
                      })
                    }
                  >
                    Test
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await invokeNative('bitbucket_connection_remove');
                        setBitbucket(null);
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!loaded || adding === 'bitbucket'}
                  onClick={() => setAdding('bitbucket')}
                >
                  Connect
                </Button>
              ),
            },
            ...hosts.map((item) => ({
              id: `host-${item.host}`,
              icon: <Server size={16} />,
              title: item.host,
              ...(item.kind === 'gitlab'
                ? gitlabRow(item.host)
                : { status: 'GitHub Enterprise', description: 'Uses the GitHub CLI.' }),
              actions: (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void act(async () =>
                      setHosts(
                        await invokeNative<ConfiguredHost[]>('source_control_host_remove', {
                          host: item.host,
                        }),
                      ),
                    )
                  }
                >
                  Remove
                </Button>
              ),
            })),
          ]}
          action={
            !adding && (
              <Button variant="secondary" disabled={!loaded} onClick={() => setAdding('host')}>
                <Plus size={16} aria-hidden="true" />
                Add a self-managed host
              </Button>
            )
          }
        />
        {adding === 'host' && (
          <AddHost
            busy={busy}
            onCancel={() => setAdding(null)}
            onAdd={(host, kind) =>
              act(async () => {
                const next = await invokeNative<ConfiguredHost[]>('source_control_host_save', {
                  host,
                  kind,
                });
                setHosts(next);
                setAdding(null);
                const unchecked = next
                  .filter((item) => item.kind === 'gitlab' && !gitlab[item.host])
                  .map((item) => item.host);
                if (unchecked.length) void checkGitlab(unchecked);
              })
            }
          />
        )}
        {adding === 'bitbucket' && (
          <ConnectBitbucket
            onCancel={() => setAdding(null)}
            onConnected={(connection) => {
              forgetProjectHosts();
              setBitbucket(connection);
              setAdding(null);
              setNotice(`Bitbucket connected as ${connection.name ?? connection.email}.`);
            }}
          />
        )}
        {notice && (
          <InlineNotice tone="success" action={<CloseNotice onClose={() => setNotice('')} />}>
            {notice}
          </InlineNotice>
        )}
        <ActionError error={error} />
      </div>
    </SettingGroup>
  );
}

function CloseNotice({ onClose }: { onClose: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClose}>
      Dismiss
    </Button>
  );
}

function AddHost({
  busy,
  onAdd,
  onCancel,
}: {
  busy: boolean;
  onAdd: (host: string, kind: 'gitlab' | 'github') => Promise<void>;
  onCancel: () => void;
}) {
  const [host, setHost] = useState('');
  const [kind, setKind] = useState<'gitlab' | 'github'>('gitlab');
  return (
    <form
      className="settings-setup-fields"
      onSubmit={(event) => {
        event.preventDefault();
        if (host.trim()) void onAdd(host.trim(), kind);
      }}
    >
      <FormField label="Host name">
        <Input
          required
          placeholder="gitlab.example.com"
          value={host}
          disabled={busy}
          autoFocus
          onChange={(event) => setHost(event.target.value)}
        />
      </FormField>
      <FormField label="Kind">
        <Select
          value={kind}
          disabled={busy}
          onValueChange={(value) => setKind(value as 'gitlab' | 'github')}
        >
          <SelectItem value="gitlab">GitLab (self-managed)</SelectItem>
          <SelectItem value="github">GitHub Enterprise</SelectItem>
        </Select>
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" loading={busy} loadingLabel="Saving…" disabled={!host.trim()}>
          Add host
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ConnectBitbucket({
  onConnected,
  onCancel,
}: {
  onConnected: (connection: BitbucketConnection) => void;
  onCancel: () => void;
}) {
  const [opened, setOpened] = useState(false);
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connect = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const connection = await invokeNative<BitbucketConnection>('bitbucket_connection_save', {
        email: email.trim(),
        token: token.trim(),
      });
      setToken('');
      onConnected(connection);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-setup-flow">
      <SetupSteps
        label="Connect Bitbucket Cloud"
        steps={[
          {
            id: 'token',
            title: 'Create an API token with scopes',
            hint: 'On your Atlassian account, choose Create API token with scopes, pick Bitbucket and select these scopes.',
            state: opened ? 'done' : 'current',
            summary: 'Token page opened',
            content: (
              <div className="settings-setup-fields">
                <ul className="code-host-scopes" aria-label="Required scopes">
                  {BITBUCKET_SCOPES.map((scope) => (
                    <li key={scope}>
                      <code>{scope}</code>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      void openExternalUrl(BITBUCKET_TOKEN_URL)
                        .then(() => setOpened(true))
                        .catch((cause) => setError(describeError(cause)))
                    }
                  >
                    Open Atlassian token page
                  </Button>
                  {!opened && (
                    <Button type="button" variant="ghost" onClick={() => setOpened(true)}>
                      I have a token
                    </Button>
                  )}
                </div>
              </div>
            ),
          },
          {
            id: 'paste',
            title: 'Paste it and connect',
            hint: 'Jackalope checks the token with Bitbucket, then keeps it in your system’s credential store.',
            state: opened ? 'current' : 'upcoming',
            content: opened && (
              <form
                className="settings-setup-fields"
                onSubmit={(event) => {
                  event.preventDefault();
                  void connect();
                }}
              >
                <FormField label="Atlassian account email">
                  <Input
                    required
                    type="email"
                    autoComplete="email"
                    value={email}
                    disabled={busy}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </FormField>
                <SecretField
                  label="API token"
                  value={token}
                  disabled={busy}
                  required
                  onValueChange={setToken}
                  check={tokenCheck}
                />
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    loading={busy}
                    loadingLabel="Checking…"
                    disabled={busy || !email.trim() || !token.trim()}
                  >
                    Connect
                  </Button>
                  <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
                    Cancel
                  </Button>
                </div>
              </form>
            ),
          },
        ]}
      />
      <ActionError error={error} />
    </div>
  );
}
