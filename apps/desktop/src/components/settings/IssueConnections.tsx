import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  ChoiceCards,
  FlowDiagram,
  type FlowState,
  FormField,
  GitHubIcon,
  InlineNotice,
  Input,
  type SecretCheck,
  SecretField,
  SettingGroup,
  SetupList,
  SetupSteps,
} from '@jackalope/ui';
import { KanbanSquare, Laptop, Plus, SquareKanban } from 'lucide-react';
import './setup-screens.css';
import { useCallback, useEffect, useState } from 'react';
import { openExternalUrl } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';

type Provider = 'linear' | 'jira';

const SERVICES: Record<Provider, { name: string; tokenUrl: string; tokenPrefix: string }> = {
  linear: {
    name: 'Linear',
    tokenUrl: 'https://linear.app/settings/api',
    tokenPrefix: 'lin_api_',
  },
  jira: {
    name: 'Jira Cloud',
    tokenUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
    tokenPrefix: 'ATATT',
  },
};

/** Advises on a pasted token's shape; the real check is connecting. */
function tokenCheck(provider: Provider) {
  return (value: string): SecretCheck | undefined =>
    value.trim().startsWith(SERVICES[provider].tokenPrefix)
      ? { tone: 'ok', message: `Looks like a ${SERVICES[provider].name} token.` }
      : {
          tone: 'info',
          message: `${SERVICES[provider].name} tokens usually start with ${SERVICES[provider].tokenPrefix}. Connecting will check it.`,
        };
}

/**
 * Issue trackers agents can read and update. GitHub rides on the GitHub CLI sign-in; Linear
 * and Jira connect through a guided flow that ends in a real connection check.
 */
export function IssueConnections() {
  const [connections, setConnections] = useState<
    { provider: string; site: string; email: string }[]
  >([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState<Provider | undefined>();
  const [tokenOpened, setTokenOpened] = useState(false);
  const [site, setSite] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [flow, setFlow] = useState<FlowState>('idle');
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setConnections(await invokeNative('issue_connections'));
    setLoaded(true);
  }, []);
  useEffect(() => {
    void refresh().catch((cause) => setError(describeError(cause)));
  }, [refresh]);

  const reset = () => {
    setAdding(false);
    setProvider(undefined);
    setTokenOpened(false);
    setSite('');
    setEmail('');
    setToken('');
    setFlow('idle');
  };
  const service = provider ? SERVICES[provider] : undefined;
  const detailsReady = provider === 'linear' || (site.trim() !== '' && email.trim() !== '');
  const connect = async () => {
    if (busy || !provider) return;
    setBusy(true);
    setError('');
    setFlow('checking');
    try {
      await invokeNative('issue_connection_save', {
        connection: { provider, site: site.trim(), email: email.trim(), token: token.trim() },
      });
      setToken('');
      setFlow('connected');
      await refresh();
    } catch (cause) {
      setFlow('failed');
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingGroup title="Connected work">
      <div className="settings-setup-body">
        <SetupList
          label="Connected issue trackers"
          items={[
            {
              id: 'github',
              icon: <GitHubIcon size={16} />,
              title: 'GitHub',
              status: 'Uses the GitHub CLI',
              description: 'Signed in through gh auth login on this Mac.',
            },
            ...connections.map((connection) => ({
              id: connection.provider,
              icon:
                connection.provider === 'linear' ? (
                  <KanbanSquare size={16} />
                ) : (
                  <SquareKanban size={16} />
                ),
              title: connection.provider === 'linear' ? 'Linear' : 'Jira Cloud',
              status: 'Connected',
              description:
                [connection.site, connection.email].filter(Boolean).join(' · ') || undefined,
              actions: (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await invokeNative('issue_connection_remove', {
                        provider: connection.provider,
                      });
                      await refresh();
                    } catch (cause) {
                      setError(describeError(cause));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Disconnect
                </Button>
              ),
            })),
          ]}
          action={
            !adding && (
              <Button variant="secondary" disabled={!loaded} onClick={() => setAdding(true)}>
                <Plus size={16} aria-hidden="true" />
                Connect a tracker
              </Button>
            )
          }
        />
        {adding && (
          <div className="settings-setup-flow">
            <FlowDiagram
              from={{ label: 'This Mac', icon: <Laptop size={16} /> }}
              to={{ label: service?.name ?? 'Issue tracker', icon: <KanbanSquare size={16} /> }}
              via="API token"
              state={flow}
              error={flow === 'failed' ? error : undefined}
            />
            <SetupSteps
              label="Connect an issue tracker"
              steps={[
                {
                  id: 'service',
                  title: 'Choose the service',
                  state: provider ? 'done' : 'current',
                  summary: service?.name,
                  content: (
                    <ChoiceCards
                      label="Service"
                      value={provider}
                      disabled={busy}
                      onValueChange={(value) => {
                        setProvider(value);
                        setToken('');
                        setFlow('idle');
                      }}
                      options={[
                        {
                          value: 'linear',
                          title: 'Linear',
                          description: 'A personal API key from your Linear settings.',
                          icon: <KanbanSquare size={18} />,
                        },
                        {
                          value: 'jira',
                          title: 'Jira Cloud',
                          description: 'Your Atlassian site, email and an API token.',
                          icon: <SquareKanban size={18} />,
                        },
                      ]}
                    />
                  ),
                },
                {
                  id: 'token',
                  title: 'Create an API token',
                  hint: service
                    ? `Open ${service.name}'s token page, create a token and copy it.`
                    : undefined,
                  state: !provider ? 'upcoming' : tokenOpened && detailsReady ? 'done' : 'current',
                  summary:
                    provider === 'jira' ? `${site.trim()} · ${email.trim()}` : 'Token page opened',
                  content: service && (
                    <div className="settings-setup-fields">
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
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            void openExternalUrl(service.tokenUrl)
                              .then(() => setTokenOpened(true))
                              .catch((cause) => setError(describeError(cause)))
                          }
                        >
                          Open {service.name} token page
                        </Button>
                        {!tokenOpened && (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setTokenOpened(true)}
                          >
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
                  hint: 'Jackalope checks the token with the service before saving it.',
                  state:
                    flow === 'connected'
                      ? 'done'
                      : provider && tokenOpened && detailsReady
                        ? 'current'
                        : 'upcoming',
                  summary: service ? `${service.name} connected` : undefined,
                  editLabel: 'Connect another',
                  content: provider && (
                    <form
                      className="settings-setup-fields"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void connect();
                      }}
                    >
                      <SecretField
                        label="API token"
                        value={token}
                        disabled={busy}
                        required
                        onValueChange={(value) => {
                          setToken(value);
                          if (flow === 'failed') setFlow('idle');
                        }}
                        check={tokenCheck(provider)}
                      />
                      <div className="flex gap-2">
                        <Button
                          type="submit"
                          loading={busy}
                          loadingLabel="Checking…"
                          disabled={busy || !loaded || !token.trim() || !detailsReady}
                        >
                          Connect
                        </Button>
                        <Button type="button" variant="ghost" disabled={busy} onClick={reset}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ),
                },
              ]}
            />
            {flow === 'connected' && (
              <Button variant="secondary" onClick={reset}>
                Done
              </Button>
            )}
          </div>
        )}
        {error && flow !== 'failed' && (
          <InlineNotice tone="error">
            {error}
            {!loaded && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void refresh()
                    .then(() => setError(''))
                    .catch((cause) => setError(describeError(cause)))
                }
              >
                Retry
              </Button>
            )}
          </InlineNotice>
        )}
      </div>
    </SettingGroup>
  );
}
