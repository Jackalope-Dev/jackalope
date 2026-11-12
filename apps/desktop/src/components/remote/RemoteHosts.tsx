import { describeError } from '@jackalope/contracts/errors';
import type { RemoteAction } from '@jackalope/contracts/remote';
import {
  Button,
  ChoiceCards,
  Disclosure,
  DisclosureSummary,
  FieldCheck,
  FlowDiagram,
  FormField,
  InlineNotice,
  Input,
  Popover,
  Select,
  SelectItem,
  SetupIntro,
  SetupLayout,
  type SetupStepState,
  SetupSteps,
  SetupSummary,
} from '@jackalope/ui';
import {
  ArrowRight,
  Box,
  Globe,
  KeyRound,
  Laptop,
  ListChecks,
  MonitorSmartphone,
  Server,
  Share2,
  Smartphone,
  Terminal,
  Wifi,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useId, useState } from 'react';
import { invokeNative } from '../../lib/native/transport';
import {
  checkHttpsOrigin,
  checkPairingCode,
  checkSshAlias,
  type FieldCheckResult,
  formatPairingCode,
  thisComputerLabel,
} from '../../lib/remote-checks';
import {
  pairRemoteHost,
  type RemoteHost,
  remoteHosts,
  removeRemoteHost,
} from '../../lib/remote-hosts';
import { useHostContextStore } from '../../stores/hostContextStore';
import { InvitePhone } from './InvitePhone';
import { RemoteWorkspace } from './RemoteWorkspace';

const METHOD_LABEL: Record<string, string> = { ssh: 'SSH', https: 'HTTPS', wsl: 'WSL' };

/** Where the pairing code is made on the other computer, as the path a person clicks through. */
const HOST_PATH: { icon: ReactNode; label: string }[] = [
  { icon: <MonitorSmartphone size={14} />, label: 'Devices' },
  { icon: <Wifi size={14} />, label: 'Let devices use this one' },
  { icon: <ListChecks size={14} />, label: 'Choose projects' },
  { icon: <KeyRound size={14} />, label: 'Create pairing code' },
];

function HostPath() {
  return (
    <ol className="remote-host-path" aria-label="On the other computer">
      {HOST_PATH.map((step, index) => (
        <li key={step.label}>
          {index > 0 && (
            <ArrowRight size={12} className="remote-host-path-arrow" aria-hidden="true" />
          )}
          <span className="remote-host-path-step">
            <span aria-hidden="true">{step.icon}</span>
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Check({ id, result }: { id: string; result: FieldCheckResult | null }) {
  return result ? (
    <FieldCheck id={id} tone={result.tone}>
      {result.message}
    </FieldCheck>
  ) : null;
}

/**
 * How to reach a host from the phone app. The phone pairs with each computer directly, so it
 * keeps working while this one is offline; that pairing is created on the host itself.
 */
function PhoneAccess({ id, name }: { id: string; name: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="outline">
          <Smartphone size={16} aria-hidden="true" />
          Use from your phone
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="workspace-menu remote-phone-access"
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={16}
        >
          <h3>Use {name} from your phone</h3>
          <p>
            The Jackalope app pairs with each computer directly, so it keeps working while this one
            is offline. If {name} lets paired computers invite phones, get its code here:
          </p>
          <InvitePhone hostId={id} name={name} />
          <p>Or set it up on {name}:</p>
          <ol>
            <li>Keep Jackalope running.</li>
            <li>
              Open Devices → Let devices use this one, turn on remote access and choose projects.
            </li>
            <li>
              Set up an HTTPS address there (the Tailscale steps), since phones only use HTTPS.
            </li>
            <li>Choose Pair a phone and scan the code with the Jackalope app.</li>
          </ol>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Devices → Use other computers: pair with hosts and work on them from here. */
export function RemoteHosts({ onShare }: { onShare: () => void }) {
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
  /** The last pairing attempt's real error, shown on the connection diagram. */
  const [pairError, setPairError] = useState('');
  /** The furthest step the person has moved on to; earlier steps fold to their summary. */
  const [reached, setReached] = useState(0);
  const advance = (step: number) => setReached((value) => Math.max(value, step));
  const addressCheckId = useId();
  const codeCheckId = useId();
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
  const addressCheck =
    method === 'ssh'
      ? checkSshAlias(address)
      : method === 'https'
        ? checkHttpsOrigin(address)
        : null;
  const codeCheck = checkPairingCode(code);
  const placeReady =
    Boolean(name.trim()) && (method === 'wsl' ? Boolean(address) : addressCheck?.tone === 'ok');
  const ready = placeReady && codeCheck?.tone === 'ok';
  const stepState = (index: number): SetupStepState =>
    index < reached ? 'done' : index === reached ? 'current' : 'upcoming';
  const place = `${name.trim() || 'Unnamed'} · ${address.trim() || 'no address'}${
    method !== 'https' && port !== 9472 ? ` (port ${port})` : ''
  }`;
  const connectSteps = () => [
    {
      id: 'code',
      title: 'On the other computer, create a pairing code',
      hint: 'It works once and expires after a few minutes, so make it when you’re ready.',
      state: stepState(0),
      summary: 'A pairing code is ready on the other computer.',
      content: (
        <>
          <HostPath />
          {reached === 0 && (
            <Button variant="outline" className="justify-self-start" onClick={() => advance(1)}>
              I have a code
            </Button>
          )}
        </>
      ),
    },
    {
      id: 'method',
      title: 'Choose how to reach it',
      hint: 'Pick the way this computer can already reach the other one.',
      state: stepState(1),
      summary: `Over ${METHOD_LABEL[method]}`,
      content: (
        <>
          <ChoiceCards
            label="Connection"
            value={method}
            disabled={busy}
            onValueChange={(value) => {
              setMethod(value);
              setAddress('');
              setError('');
              setPairError('');
              advance(2);
            }}
            options={[
              {
                value: 'ssh',
                icon: <Terminal size={18} />,
                title: 'SSH',
                description: 'Uses an SSH alias that already works in your terminal.',
              },
              {
                value: 'https',
                icon: <Globe size={18} />,
                title: 'HTTPS',
                description: 'The other computer has an HTTPS address, such as from Tailscale.',
              },
              ...(/Win/i.test(navigator.platform)
                ? [
                    {
                      value: 'wsl',
                      icon: <Box size={18} />,
                      title: 'WSL distribution',
                      description: 'A Linux distribution on this PC.',
                    },
                  ]
                : []),
            ]}
          />
          {reached === 1 && (
            <Button variant="outline" className="justify-self-start" onClick={() => advance(2)}>
              Continue
            </Button>
          )}
        </>
      ),
    },
    {
      id: 'address',
      title: 'Name it and say where it is',
      hint: 'The name is only for you; the address is how this computer reaches it.',
      state: stepState(2),
      summary: place,
      content: (
        <>
          <FormField label="Name" className="remote-field-name">
            <Input
              value={name}
              disabled={busy}
              required
              maxLength={80}
              placeholder="Workstation"
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <div className="remote-connect-field remote-field-address">
            <FormField
              label={
                method === 'wsl'
                  ? 'WSL distribution'
                  : method === 'ssh'
                    ? 'SSH host'
                    : 'HTTPS address'
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
                  spellCheck={false}
                  aria-describedby={addressCheck ? addressCheckId : undefined}
                  placeholder={method === 'ssh' ? 'user@workstation' : 'https://workstation:8443'}
                  value={address}
                  disabled={busy}
                  onChange={(event) => setAddress(event.target.value)}
                />
              )}
            </FormField>
            <Check id={addressCheckId} result={addressCheck} />
          </div>
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
                className="remote-field-port"
                type="number"
                min={1024}
                max={65535}
                value={port}
                disabled={busy}
                onChange={(event) => setPort(Number(event.target.value))}
              />
            </Disclosure>
          )}
          {reached === 2 && (
            <Button
              variant="outline"
              className="justify-self-start"
              disabled={!placeReady}
              onClick={() => advance(3)}
            >
              Continue
            </Button>
          )}
        </>
      ),
    },
    {
      id: 'pair',
      title: 'Enter the pairing code',
      hint: 'Type it as shown on the other computer; it formats itself.',
      state: stepState(3),
      content: (
        <div className="remote-connect-field">
          <FormField label="Pairing code">
            <Input
              required
              autoComplete="off"
              spellCheck={false}
              className="remote-connect-code"
              aria-describedby={codeCheck ? codeCheckId : undefined}
              placeholder="ABCDE-FGHJK"
              value={code}
              disabled={busy}
              onChange={(event) => setCode(formatPairingCode(event.target.value))}
            />
          </FormField>
          <Check id={codeCheckId} result={codeCheck} />
          <Button
            type="submit"
            className="justify-self-start remote-connect-submit"
            disabled={busy || !ready}
            loading={busy}
            loadingLabel="Connecting…"
          >
            Connect
          </Button>
        </div>
      ),
    },
  ];
  return (
    <>
      {!!hosts.length && (
        <div className="workspace-actions remote-hosts-actions">
          <Button
            variant={adding ? 'outline' : 'primary'}
            disabled={busy || !loaded}
            onClick={() => {
              setAdding((value) => !value);
              setPairError('');
            }}
          >
            {adding ? 'Cancel' : 'Connect a host'}
          </Button>
        </div>
      )}
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
            {host && <PhoneAccess id={host.id} name={host.name} />}
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
          <>
            <SetupIntro
              icon={<Server size={20} />}
              title="Work on another computer from here"
              description="Pair with a computer running Jackalope to follow its work, start tasks and answer questions without leaving this one."
              action={
                <Button variant="outline" onClick={onShare}>
                  <Share2 size={16} aria-hidden="true" />
                  Share this computer instead
                  <span className="remote-intro-destination">Let devices use this one</span>
                </Button>
              }
            />
            <SetupLayout
              aside={
                <>
                  <FlowDiagram
                    from={{ label: thisComputerLabel(), icon: <Laptop size={15} /> }}
                    to={{ label: name.trim() || 'Other computer', icon: <Server size={15} /> }}
                    via={METHOD_LABEL[method]}
                    state={busy ? 'checking' : pairError ? 'failed' : 'idle'}
                    error={pairError}
                  />
                  <SetupSummary
                    label="Connection so far"
                    items={[
                      { label: 'Connection', value: METHOD_LABEL[method] },
                      { label: 'Name', value: name.trim() || 'Not named yet' },
                      { label: 'Address', value: address.trim() || 'Not entered yet' },
                      {
                        label: 'Pairing code',
                        value: codeCheck ? codeCheck.message : 'Not entered yet',
                      },
                    ]}
                  />
                  <p className="remote-phone-note">
                    <Smartphone size={14} aria-hidden="true" />
                    Phones pair with each computer directly. To use it from your phone while this
                    one is offline, turn on Remote access on that computer too.
                  </p>
                </>
              }
            >
              <form
                className="remote-setup remote-connect"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (busy) return;
                  setBusy(true);
                  setError('');
                  setPairError('');
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
                    setReached(0);
                  } catch (cause) {
                    setPairError(describeError(cause));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <SetupSteps label="Connect a host" steps={connectSteps()} />
              </form>
            </SetupLayout>
          </>
        )}
        {host && !adding && (
          <RemoteWorkspace
            key={host.id}
            request={request}
            storageKey={`jackalope-remote:${host.id}`}
          />
        )}
      </div>
    </>
  );
}
