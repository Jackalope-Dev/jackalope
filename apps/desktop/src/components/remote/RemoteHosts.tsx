import {
  Button,
  Disclosure,
  DisclosureSummary,
  FormField,
  Input,
  Select,
  SelectItem,
} from '@jackalope/ui';
import { useCallback, useEffect, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { useHostContextStore } from '../../stores/hostContextStore';
import { InlineNotice } from '../ui/InlineNotice';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { type RemoteAction, RemoteWorkspace } from './RemoteWorkspace';

interface Host {
  id: string;
  name: string;
  address: string;
  ssh: boolean;
  port: number;
  wsl?: boolean;
}
export function RemoteHosts({ onSetup }: { onSetup: () => void }) {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [method, setMethod] = useState('ssh');
  const [port, setPort] = useState(9472);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [distributions, setDistributions] = useState<string[]>([]);
  const host = hosts.find((item) => item.id === selected) ?? hosts[0];
  useEffect(() => {
    useHostContextStore.setState({
      host: host && !adding ? { name: host.name, wsl: !!host.wsl, address: host.address } : null,
    });
    return () => {
      useHostContextStore.setState({ host: null });
    };
  }, [host, adding]);
  useEffect(() => {
    if (method !== 'wsl') return;
    let disposed = false;
    void nativeTask<string[]>('wsl_distributions').then(
      (items) => {
        if (!disposed) setDistributions(items);
      },
      (reason) => {
        if (!disposed) setError(String(reason));
      },
    );
    return () => {
      disposed = true;
    };
  }, [method]);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await nativeTask<Host[]>('remote_hosts');
      if (!signal?.aborted) {
        setHosts(next);
        setLoaded(true);
        setError('');
      }
    } catch (cause) {
      if (!signal?.aborted) setError(String(cause));
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const request = useCallback(
    <T,>(action: RemoteAction) => nativeTask<T>('remote_host_request', { id: host?.id, action }),
    [host?.id],
  );
  return (
    <WorkspacePage>
      <WorkspaceHeading
        title="Hosts"
        action={
          <Button variant="outline" onClick={onSetup}>
            Share this host
          </Button>
        }
      />
      <div className="remote-workspace">
        <div className="remote-toolbar">
          {!!hosts.length && (
            <Select
              aria-label="Host"
              disabled={busy}
              value={host?.id}
              onValueChange={(id) => {
                setSelected(id);
                setAdding(false);
              }}
            >
              {hosts.map((item) => (
                <SelectItem value={item.id} key={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </Select>
          )}
          <Button
            variant="outline"
            disabled={busy || !loaded}
            onClick={() => setAdding((value) => !value)}
          >
            {adding ? 'Cancel' : 'Connect a host'}
          </Button>
          {host && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await nativeTask('remote_host_remove', { id: host.id });
                  setHosts(await nativeTask<Host[]>('remote_hosts'));
                } catch (cause) {
                  setError(String(cause));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Forget host
            </Button>
          )}
        </div>
        {error && (
          <InlineNotice tone="error">
            {error}
            {!loaded && (
              <Button variant="ghost" onClick={() => void load()}>
                Retry
              </Button>
            )}
          </InlineNotice>
        )}
        {!loaded && !error && <p role="status">Loading hosts…</p>}
        {loaded && (adding || !hosts.length) && (
          <form
            className="remote-setup"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError('');
              try {
                const paired = await nativeTask<Host>('remote_host_pair', {
                  name,
                  address,
                  ssh: method === 'ssh',
                  wsl: method === 'wsl',
                  port,
                  code: code.trim(),
                });
                setHosts(await nativeTask<Host[]>('remote_hosts'));
                setSelected(paired.id);
                setAdding(false);
                setCode('');
              } catch (cause) {
                setError(String(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            <p className="task-muted">
              On the host, open Settings → Remote access, choose its projects and create a pairing
              code.
            </p>
            <FormField label="Name">
              <Input
                value={name}
                disabled={busy}
                required
                maxLength={80}
                placeholder="Workstation"
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            <FormField label="Connection">
              <Select
                value={method}
                onValueChange={(value) => {
                  setMethod(value);
                  setAddress('');
                  setError('');
                }}
                disabled={busy}
              >
                <SelectItem value="ssh">SSH</SelectItem>
                <SelectItem value="https">HTTPS</SelectItem>
                {/Win/i.test(navigator.platform) && (
                  <SelectItem value="wsl">WSL distribution</SelectItem>
                )}
              </Select>
            </FormField>
            <FormField
              label={
                method === 'wsl'
                  ? 'WSL distribution'
                  : method === 'ssh'
                    ? 'SSH host'
                    : 'HTTPS address'
              }
              description={
                method === 'ssh'
                  ? 'Use an alias that already connects from your terminal.'
                  : undefined
              }
            >
              {method === 'wsl' ? (
                <Select
                  aria-label="WSL distribution"
                  value={address || '__choose'}
                  onValueChange={setAddress}
                  disabled={busy}
                >
                  <SelectItem value="__choose" disabled>
                    {distributions.length ? 'Choose a distribution…' : 'No distributions found'}
                  </SelectItem>
                  {distributions.map((distribution) => (
                    <SelectItem key={distribution} value={distribution}>
                      {distribution}
                    </SelectItem>
                  ))}
                </Select>
              ) : (
                <Input
                  type={method === 'ssh' ? 'text' : 'url'}
                  required
                  placeholder={method === 'ssh' ? 'user@workstation' : 'https://workstation:8443'}
                  value={address}
                  disabled={busy}
                  onChange={(event) => setAddress(event.target.value)}
                />
              )}
            </FormField>
            {method === 'wsl' && (
              <p className="task-muted">
                Start the Linux build of Jackalope inside this distribution, configure its projects
                and agent accounts, then create a pairing code in its Remote access settings. Python
                3 is required for the connection. Tasks, Git, setup and checks execute in Linux
                using that host’s credentials.
              </p>
            )}
            {(method === 'ssh' || method === 'wsl') && (
              <Disclosure>
                <DisclosureSummary>Host port</DisclosureSummary>
                <Input
                  aria-label="Host port"
                  type="number"
                  min={1024}
                  max={65535}
                  value={port}
                  disabled={busy}
                  onChange={(event) => setPort(Number(event.target.value))}
                />
              </Disclosure>
            )}
            <FormField label="Pairing code">
              <Input
                type="password"
                required
                autoComplete="off"
                value={code}
                disabled={busy}
                onChange={(event) => setCode(event.target.value)}
              />
            </FormField>
            <Button
              type="submit"
              disabled={busy || !address}
              loading={busy}
              loadingLabel="Connecting…"
            >
              Connect
            </Button>
          </form>
        )}
        {host && !adding && (
          <RemoteWorkspace
            key={host.id}
            request={request}
            storageKey={`jackalope-remote:${host.id}`}
          />
        )}
      </div>
    </WorkspacePage>
  );
}
