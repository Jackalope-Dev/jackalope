import { EchoMark } from '@jackalope/brand/echo';
import { describeError } from '@jackalope/contracts/errors';
import { BorderBeamLayer, Button, ThinkingOrb } from '@jackalope/ui';
import {
  Cloud,
  Laptop,
  MonitorSmartphone,
  Plus,
  Server,
  Smartphone,
  TerminalSquare,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { type CloudMachine, cloudMachines } from '../../lib/computers';
import { isTauriEnvironment } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import { thisComputerLabel } from '../../lib/remote-checks';
import { type RemoteHost, remoteHosts } from '../../lib/remote-hosts';
import { useDevicesStore } from '../../stores/devicesStore';
import type { DevicesTab } from '../../stores/viewTabStore';

/** The parts of `remote_status` the map draws. */
interface AccessStatus {
  listening: boolean;
  publicOrigin: string;
  devices: { id: string; name: string; pairedAt: string; invitedBy?: string | null }[];
  error: string | null;
}

interface Overview {
  access: AccessStatus | null;
  hosts: RemoteHost[] | null;
  machines: CloudMachine[] | null;
  hostedAvailable: boolean;
  error: string;
}

/** Shown per group before the rest fold into a count. */
const SHOWN = 3;

const phoneLike = /iphone|ipad|android|pixel|galaxy|phone/i;

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function pairedOn(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'Paired'
    : `Paired ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/** Everything the map shows, loaded together and again whenever a section changes it. */
function useOverview() {
  const revision = useDevicesStore((state) => state.revision);
  const [overview, setOverview] = useState<Overview>({
    access: null,
    hosts: null,
    machines: null,
    hostedAvailable: false,
    error: '',
  });
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!isTauriEnvironment()) return;
    const [access, hosts, machines] = await Promise.allSettled([
      invokeNative<AccessStatus>('remote_status'),
      remoteHosts(),
      cloudMachines(),
    ]);
    if (signal?.aborted) return;
    const failed = [access, hosts, machines].find((result) => result.status === 'rejected');
    setOverview({
      access: access.status === 'fulfilled' ? access.value : null,
      hosts: hosts.status === 'fulfilled' ? hosts.value : null,
      machines: machines.status === 'fulfilled' ? machines.value.machines : null,
      hostedAvailable: machines.status === 'fulfilled' && machines.value.hostedAvailable,
      error: failed?.status === 'rejected' ? describeError(failed.reason) : '',
    });
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision marks a change made in a section below.
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, revision]);
  // A device paired from the phone or another computer shows up when the window returns.
  useEffect(() => {
    const refresh = () => document.visibilityState === 'visible' && void load();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);
  return { overview, reload: () => void load() };
}

function Node({
  icon,
  title,
  detail,
  onSelect,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  onSelect: () => void;
}) {
  return (
    <li className="devices-node">
      <button type="button" className="devices-node-card" onClick={onSelect}>
        <span className="devices-node-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="devices-node-text">
          <span className="devices-node-title">{title}</span>
          <span className="devices-node-detail">{detail}</span>
        </span>
      </button>
    </li>
  );
}

/** The dashed place where the next device of a kind goes, or that device arriving. */
function Slot({
  label,
  busyLabel,
  busy,
  disabled,
  onSelect,
}: {
  label: string;
  busyLabel: string;
  busy: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <li className="devices-node">
      <button
        type="button"
        className="devices-node-card devices-slot"
        data-busy={busy || undefined}
        disabled={disabled}
        onClick={onSelect}
      >
        <BorderBeamLayer variant="pulse" active={busy} strength={0.7} />
        <span className="devices-node-icon" aria-hidden="true">
          {busy ? (
            <ThinkingOrb state="connecting" size={20} aria-hidden="true" />
          ) : (
            <Plus size={16} />
          )}
        </span>
        <span className="devices-node-text">
          <span className="devices-node-title">{busy ? busyLabel : label}</span>
        </span>
      </button>
    </li>
  );
}

function More({ count, onSelect }: { count: number; onSelect: () => void }) {
  return count > 0 ? (
    <li className="devices-node">
      <button type="button" className="devices-more" onClick={onSelect}>
        {count} more
      </button>
    </li>
  ) : null;
}

/**
 * This computer at the centre and everything paired with it: phones and computers that use
 * it on the left, computers it uses and cloud machines on the right. Links say only what is
 * known (paired, remote access on or off); nothing here claims a device is online.
 */
export function DeviceMap({
  onOpen,
}: {
  /** Shows a section below, optionally asking it to start a setup flow. */
  onOpen: (tab: DevicesTab, intent?: 'connect-host' | 'add-machine') => void;
}) {
  const { overview, reload } = useOverview();
  const waitingForPhone = useDevicesStore((state) => state.waitingForPhone);
  const connectingHost = useDevicesStore((state) => state.connectingHost);
  const native = isTauriEnvironment();
  const computer = thisComputerLabel();
  const { access, hosts, machines } = overview;
  const users = access?.devices ?? [];
  const listening = Boolean(access?.listening);
  const accessLabel = !access
    ? native
      ? 'Checking…'
      : 'Open the desktop app'
    : access.error
      ? 'Remote access has a problem'
      : listening
        ? access.publicOrigin
          ? 'Remote access on · phones can connect'
          : 'Remote access on · computers only'
        : 'Remote access off';

  return (
    <div className="devices-map-frame">
      <section className="devices-map" aria-label="Your devices">
        <div className="devices-map-group" data-side="in" data-link={listening ? 'on' : 'off'}>
          <h3 className="devices-map-heading">Use {computer} from</h3>
          <ul className="devices-map-list">
            {users.slice(0, SHOWN).map((device) => (
              <Node
                key={device.id}
                icon={phoneLike.test(device.name) ? <Smartphone size={16} /> : <Laptop size={16} />}
                title={device.name}
                detail={
                  device.invitedBy ? `Invited by ${device.invitedBy}` : pairedOn(device.pairedAt)
                }
                onSelect={() => onOpen('share')}
              />
            ))}
            <More count={users.length - SHOWN} onSelect={() => onOpen('share')} />
            <Slot
              label="Pair a phone or computer"
              busyLabel="Waiting for it to pair"
              busy={waitingForPhone}
              disabled={!native}
              onSelect={() => onOpen('share')}
            />
          </ul>
        </div>

        <div
          className="devices-hub"
          data-state={access?.error ? 'error' : listening ? 'on' : 'off'}
        >
          <span className="devices-hub-glow" aria-hidden="true" />
          <span className="devices-hub-mark">
            <EchoMark animated={false} />
          </span>
          <strong className="devices-hub-title">{computer}</strong>
          <span className="devices-hub-status" role="status">
            <span className="devices-hub-dot" aria-hidden="true" />
            {accessLabel}
          </span>
          {overview.error && (
            <span className="devices-hub-error">
              {overview.error}
              <Button variant="ghost" size="sm" onClick={reload}>
                Retry
              </Button>
            </span>
          )}
        </div>

        <div className="devices-map-side">
          <div
            className="devices-map-group"
            data-side="out"
            data-link={hosts?.length ? 'on' : 'off'}
          >
            <h3 className="devices-map-heading">Computers you use</h3>
            <ul className="devices-map-list">
              {(hosts ?? []).slice(0, SHOWN).map((host) => (
                <Node
                  key={host.id}
                  icon={host.wsl ? <TerminalSquare size={16} /> : <Server size={16} />}
                  title={host.name}
                  detail={`${host.wsl ? 'WSL' : host.ssh ? 'SSH' : 'HTTPS'} · ${host.wsl ? host.address : hostOf(host.address)}`}
                  onSelect={() => onOpen('use')}
                />
              ))}
              <More count={(hosts?.length ?? 0) - SHOWN} onSelect={() => onOpen('use')} />
              <Slot
                label="Connect a computer"
                busyLabel="Connecting…"
                busy={connectingHost}
                disabled={!native}
                onSelect={() => onOpen('use', 'connect-host')}
              />
            </ul>
          </div>
          <div
            className="devices-map-group"
            data-side="out"
            data-link={machines?.length ? 'on' : 'off'}
          >
            <h3 className="devices-map-heading">Cloud machines</h3>
            <ul className="devices-map-list">
              {(machines ?? []).slice(0, SHOWN).map((machine) => (
                <Node
                  key={machine.id}
                  icon={<Cloud size={16} />}
                  title={machine.name}
                  detail={hostOf(machine.url)}
                  onSelect={() => onOpen('cloud')}
                />
              ))}
              <More count={(machines?.length ?? 0) - SHOWN} onSelect={() => onOpen('cloud')} />
              <Slot
                label="Pair a cloud machine"
                busyLabel="Pairing…"
                busy={false}
                disabled={!native}
                onSelect={() => onOpen('cloud', 'add-machine')}
              />
            </ul>
          </div>
        </div>
        {!native && (
          <p className="devices-map-note">
            <MonitorSmartphone size={14} aria-hidden="true" />
            Devices are read from the desktop app.
          </p>
        )}
      </section>
    </div>
  );
}
