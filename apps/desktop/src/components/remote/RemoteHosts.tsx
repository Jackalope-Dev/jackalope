import { describeError } from '@jackalope/contracts/errors';
import type { RemoteAction } from '@jackalope/contracts/remote';
import {
  Button,
  Disclosure,
  DisclosureSummary,
  FormField,
  InlineNotice,
  Input,
  Select,
  SelectItem,
} from '@jackalope/ui';
import { useCallback, useEffect, useState } from 'react';
import { invokeNative } from '../../lib/native/transport';
import {
  pairRemoteHost,
  type RemoteHost,
  remoteHosts,
  removeRemoteHost,
} from '../../lib/remote-hosts';
import { useHostContextStore } from '../../stores/hostContextStore';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { RemoteWorkspace } from './RemoteWorkspace';

export function RemoteHosts({ onSetup }: { onSetup: () => void }) {
  const [hosts, setHosts] = useState<RemoteHost[]>([]);
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
    void invokeNative<string[]>('wsl_distributions').then(
      (items) => {
        if (!disposed) setDistributions(items);
      },
      (reason) => {
        if (!disposed) setError(describeError(reason));
      },
    );
    return () => {
      disposed = true;
    };
  }, [method]);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await remoteHosts();
      if (!signal?.aborted) {
        setHosts(next);
        setLoaded(true);
        setError('');
      }
    } catch (cause) {
      if (!signal?.aborted) setError(describeError(cause));
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const request = useCallback(
    <T,>(action: RemoteAction) => invokeNative<T>('remote_host_request', { id: host?.id, action }),
    [host?.id],
  );
  return (
    <WorkspacePage>
      <WorkspaceHeading
        title="Hosts"
        action={
          <div className="workspace-actions">
            <Button variant="outline" onClick={onSetup}>
              Share this host
            </Button>
            <Button
              variant={adding ? 'outline' : 'primary'}
              disabled={busy || !loaded}
              onClick={() => setAdding((value) => !value)}
            >
              {adding ? 'Cancel' : 'Connect a host'}
            </Button>
          </div>
        }
      />
      <div className="remote-workspace">
        {!!hosts.length && (
          <div className="remote-toolbar">
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
            {host && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await removeRemoteHost(host.id);
                    setHosts(await remoteHosts());
                  } catch (cause) {
                    setError(describeError(cause));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Forget host
              </Button>
            )}
          </div>
        )}
        {error && (
          <InlineNotice
            tone="error"
            action={
              !loaded && (
                <Button variant="outline" size="sm" onClick={() => void load()}>
                  Retry
                </Button>
              )
            }
          >
            {error}
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
                const paired = await pairRemoteHost({
                  name,
                  address,
                  ssh: method === 'ssh',
                  wsl: method === 'wsl',
                  port,
                  code: code.trim(),
                });
                setHosts(await remoteHosts());
                setSelected(paired.id);
                setAdding(false);
                setCode('');
              } catch (cause) {
                setError(describeError(cause));
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
                Run the Linux build of Jackalope in this distribution (needs Python 3) and create a
                code there. Tasks run in Linux with its own accounts.
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
                required
                autoComplete="off"
                spellCheck={false}
                placeholder="ABCDE-FGHJK"
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
