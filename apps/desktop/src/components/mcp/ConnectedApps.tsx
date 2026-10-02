import {
  Badge,
  ConfirmDialog,
  FormField,
  Input,
  RefreshIcon,
  SearchField,
  SegmentedControl,
} from '@jackalope/ui';
import { ExternalLink, KeyRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AppState,
  appState,
  authorizeComposioApp,
  type ComposioAccount,
  type ComposioStatus,
  type ComposioToolkit,
  composioAccounts,
  composioCatalog,
  composioStatus,
  disconnectComposioAccount,
  FEATURED_APPS,
  removeComposioKey,
  saveComposioKey,
} from '../../lib/composio';
import { isTauriEnvironment, openExternalUrl } from '../../lib/tauri-bridge';
import { useMcpStore } from '../../stores/mcpStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { LoadingState } from '../ui/LoadingState';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import './connected-apps.css';

const DASHBOARD = 'https://dashboard.composio.dev';
const PRICING = 'https://composio.dev/pricing';
const POLL_MS = 3000;
const POLL_LIMIT = 60;

const stateLabel: Record<AppState, { label: string; variant: 'success' | 'warning' | 'danger' }> = {
  connected: { label: 'Connected', variant: 'success' },
  pending: { label: 'Waiting for sign-in', variant: 'warning' },
  failed: { label: 'Needs reconnecting', variant: 'danger' },
  available: { label: '', variant: 'success' },
};

/**
 * Connects third-party apps through the user's own Composio project. Every
 * connected app reaches agents through one managed on-demand connection.
 */
export function ConnectedApps() {
  const [status, setStatus] = useState<ComposioStatus | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!isTauriEnvironment()) return;
    try {
      setStatus(await composioStatus());
    } catch (cause) {
      setError(String(cause));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <WorkspacePage className="connected-apps">
      <WorkspaceHeading
        title="Connected apps"
        description="Sign in to apps once; every agent can use them as tools."
      />
      {!isTauriEnvironment() && (
        <InlineNotice>Connected apps are available in the desktop app.</InlineNotice>
      )}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {status === null ? (
        isTauriEnvironment() && <LoadingState compact label="Reading connected apps…" />
      ) : status.configured ? (
        <AppCatalog
          status={status}
          onRemoved={() => {
            void useMcpStore.getState().loadServers(undefined, true);
            void load();
          }}
        />
      ) : (
        <KeySetup
          onSaved={(next) => {
            setStatus(next);
            void useMcpStore.getState().loadServers(undefined, true);
          }}
        />
      )}
    </WorkspacePage>
  );
}

function KeySetup({ onSaved }: { onSaved: (status: ComposioStatus) => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="connected-apps-setup">
      <div className="connected-apps-steps">
        <h2>Connect your Composio project</h2>
        <ol>
          <li>
            Sign in to the{' '}
            <button
              type="button"
              className="connected-apps-link"
              onClick={() => void openExternalUrl(DASHBOARD)}
            >
              Composio dashboard
            </button>{' '}
            and choose or create a project.
          </li>
          <li>Open Settings → API Keys and copy a project key that starts with ak_.</li>
          <li>Paste it here. Jackalope keeps it in this device’s protected storage.</li>
        </ol>
        <p className="task-muted">
          Composio runs the sign-ins and tool calls under your own project, and bills any usage
          beyond its free plan to that project.{' '}
          <button
            type="button"
            className="connected-apps-link"
            onClick={() => void openExternalUrl(PRICING)}
          >
            Composio pricing
          </button>
        </p>
      </div>
      <form
        className="connected-apps-key"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            onSaved(await saveComposioKey(key));
            setKey('');
          } catch (cause) {
            setError(String(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <FormField
          label="Composio project key"
          error={error || undefined}
          description="Checked with Composio before it is saved."
        >
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="ak_…"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            required
          />
        </FormField>
        <Button
          type="submit"
          disabled={!key.trim() || !isTauriEnvironment()}
          loading={busy}
          loadingLabel="Checking key…"
        >
          <KeyRound size={16} aria-hidden="true" />
          Save key
        </Button>
      </form>
    </section>
  );
}

function AppCatalog({ status, onRemoved }: { status: ComposioStatus; onRemoved: () => void }) {
  const [catalog, setCatalog] = useState<ComposioToolkit[] | null>(null);
  const [accounts, setAccounts] = useState<ComposioAccount[]>([]);
  const [view, setView] = useState<'all' | 'connected'>('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [waiting, setWaiting] = useState<string | null>(null);
  const polls = useRef(0);

  const readAccounts = useCallback(async () => {
    const next = await composioAccounts();
    setAccounts(next);
    return next;
  }, []);
  const refresh = useCallback(
    async (force = false) => {
      setLoading(true);
      setError('');
      try {
        const [toolkits] = await Promise.all([composioCatalog(force), readAccounts()]);
        setCatalog(toolkits);
      } catch (cause) {
        setError(String(cause));
      } finally {
        setLoading(false);
      }
    },
    [readAccounts],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // After opening a sign-in link, watch for the account to become usable.
  useEffect(() => {
    if (!waiting) return;
    polls.current = 0;
    const timer = window.setInterval(async () => {
      polls.current += 1;
      try {
        const next = await readAccounts();
        const state = appState(next.filter((account) => account.toolkit === waiting));
        if (state === 'connected' || state === 'failed' || polls.current >= POLL_LIMIT)
          setWaiting(null);
      } catch {
        if (polls.current >= POLL_LIMIT) setWaiting(null);
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, readAccounts]);

  const byApp = useMemo(() => {
    const map = new Map<string, ComposioAccount[]>();
    for (const account of accounts)
      map.set(account.toolkit, [...(map.get(account.toolkit) ?? []), account]);
    return map;
  }, [accounts]);
  const rows = useMemo(() => {
    const items = catalog ?? [];
    const featured = FEATURED_APPS.flatMap(
      (slug) => items.find((item) => item.slug === slug) ?? [],
    );
    const ordered = [...featured, ...items.filter((item) => !FEATURED_APPS.includes(item.slug))];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return ordered.filter((item) => {
      if (view === 'connected' && appState(byApp.get(item.slug) ?? []) === 'available')
        return false;
      const text = `${item.name} ${item.slug} ${item.description} ${item.categories.join(' ')}`;
      return words.every((word) => text.toLowerCase().includes(word));
    });
  }, [catalog, query, view, byApp]);
  const connectedCount = [...byApp.values()].filter(
    (items) => appState(items) === 'connected',
  ).length;

  const connect = async (toolkit: ComposioToolkit) => {
    setBusy(toolkit.slug);
    setError('');
    try {
      const url = await authorizeComposioApp(toolkit.slug);
      await openExternalUrl(url);
      setWaiting(toolkit.slug);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy('');
    }
  };
  const disconnect = async (toolkit: ComposioToolkit) => {
    setBusy(toolkit.slug);
    setError('');
    try {
      for (const account of byApp.get(toolkit.slug) ?? [])
        await disconnectComposioAccount(account.id);
      await readAccounts();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy('');
    }
  };
  const waitingApp = catalog?.find((item) => item.slug === waiting);

  return (
    <>
      <div className="connected-apps-summary">
        <p>
          <strong>{connectedCount}</strong> {connectedCount === 1 ? 'app' : 'apps'} connected ·
          Composio project key ending in <code>{status.keyHint}</code>
        </p>
        <div className="connected-apps-summary-actions">
          <Button
            variant="ghost"
            aria-label="Refresh apps"
            disabled={loading}
            onClick={() => void refresh(true)}
          >
            <RefreshIcon />
          </Button>
          <ConfirmDialog
            trigger={<Button variant="outline">Remove key</Button>}
            title="Remove the Composio key?"
            description="Agents lose access to connected apps. Apps stay connected in your Composio project; disconnect them first if you also want to revoke their sign-ins."
            label="Remove key"
            busyLabel="Removing…"
            onConfirm={async () => {
              await removeComposioKey();
              onRemoved();
            }}
          />
        </div>
      </div>
      {waitingApp && (
        <InlineNotice
          action={
            <Button variant="ghost" onClick={() => setWaiting(null)}>
              Stop waiting
            </Button>
          }
        >
          Finish signing in to {waitingApp.name} in your browser. This page updates when the
          connection is ready.
        </InlineNotice>
      )}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <div className="connected-apps-toolbar">
        <SegmentedControl
          label="Apps to show"
          value={view}
          onChange={setView}
          items={[
            { id: 'all', label: 'All apps' },
            { id: 'connected', label: `Connected (${connectedCount})` },
          ]}
        />
        <SearchField
          aria-label="Search apps"
          placeholder="Search apps"
          value={query}
          onValueChange={setQuery}
          containerClassName="connected-apps-search"
        />
      </div>
      {catalog === null ? (
        loading && <LoadingState label="Loading apps…" />
      ) : rows.length ? (
        <ul className="connected-apps-list" aria-label="Apps">
          {rows.slice(0, query || view === 'connected' ? 200 : 60).map((toolkit) => {
            const state = appState(byApp.get(toolkit.slug) ?? []);
            return (
              <li key={toolkit.slug} className="connected-app">
                <AppLogo toolkit={toolkit} />
                <div className="connected-app-copy">
                  <strong>
                    {toolkit.name}
                    {state !== 'available' && (
                      <Badge variant={stateLabel[state].variant}>{stateLabel[state].label}</Badge>
                    )}
                  </strong>
                  <small>{toolkit.description || toolkit.categories.join(' · ')}</small>
                </div>
                {toolkit.noAuth ? (
                  <span className="task-muted connected-app-note">No sign-in needed</span>
                ) : state === 'connected' || state === 'failed' ? (
                  <div className="connected-app-actions">
                    {state === 'failed' && (
                      <Button
                        variant="outline"
                        disabled={!!busy}
                        loading={busy === toolkit.slug}
                        loadingLabel="Opening…"
                        onClick={() => void connect(toolkit)}
                      >
                        Reconnect
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      disabled={!!busy}
                      loading={busy === toolkit.slug && state === 'connected'}
                      loadingLabel="Disconnecting…"
                      onClick={() => void disconnect(toolkit)}
                    >
                      Disconnect
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    disabled={!!busy}
                    loading={busy === toolkit.slug}
                    loadingLabel="Opening…"
                    onClick={() => void connect(toolkit)}
                  >
                    {state === 'pending' ? 'Open sign-in again' : 'Connect'}
                    <ExternalLink size={14} aria-hidden="true" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="task-muted">
          {view === 'connected' ? 'No apps connected yet.' : 'No apps match this search.'}
        </p>
      )}
      {catalog && !query && view === 'all' && rows.length > 60 && (
        <p className="task-muted">
          Showing the 60 most used apps of {rows.length}. Search to find others.
        </p>
      )}
    </>
  );
}

function AppLogo({ toolkit }: { toolkit: ComposioToolkit }) {
  const [failed, setFailed] = useState(false);
  return toolkit.logo && !failed ? (
    <img
      className="connected-app-logo"
      src={toolkit.logo}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="connected-app-logo connected-app-monogram" aria-hidden="true">
      {toolkit.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
