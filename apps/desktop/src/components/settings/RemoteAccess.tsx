import {
  Button,
  Checkbox,
  CopyButton,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  FormField,
  Input,
} from '@jackalope/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { invokeNative } from '../../lib/native/transport';
import type { RunRequest } from '../../lib/run-types';
import { agentAccountFor, useProjectStore } from '../../stores/projectStore';
import { InlineNotice } from '../ui/InlineNotice';
import { Setting, SettingGroup } from './Setting';
import { TailscaleSetup } from './TailscaleSetup';
import '../remote/remote.css';

interface Status {
  enabled: boolean;
  listening: boolean;
  port: number;
  publicOrigin: string;
  projectIds: string[];
  devices: { id: string; name: string; pairedAt: string }[];
  error: string | null;
}
interface PairingCode {
  /** The short code for typing, grouped as ABCDE-FGHJK. */
  code: string;
  link: string | null;
  /** The link as QR rows, '1' for a dark module; present when there is a link. */
  qr: string[] | null;
  expiresIn: number;
}

/** Scannable from the companion app. Always dark on white so phone cameras read it in any theme. */
function PairingQr({ rows }: { rows: string[] }) {
  const size = rows.length + 8;
  const path = rows
    .flatMap((row, y) =>
      [...row].flatMap((module, x) => (module === '1' ? [`M${x + 4} ${y + 4}h1v1h-1z`] : [])),
    )
    .join('');
  return (
    <svg
      className="remote-qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="QR code for the pairing link"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
/** The typed code, large enough to read across a desk, with copy and the address. */
function TypedCode({ pair, origin }: { pair: PairingCode; origin: string }) {
  return (
    <div className="remote-pair-code">
      <output className="remote-code" aria-label={`Pairing code ${[...pair.code].join(' ')}`}>
        {pair.code}
      </output>
      {origin && (
        <p className="task-muted">
          Address: <span className="font-mono">{origin}</span>
        </p>
      )}
      <div className="remote-toolbar">
        <CopyButton size="sm" variant="outline" text={pair.code} label="Copy code" />
        {pair.link && (
          <CopyButton size="sm" variant="outline" text={pair.link} label="Copy phone link" />
        )}
      </div>
    </div>
  );
}
/**
 * A new pairing: the QR code to scan with the phone app, with the typed code folded away
 * for when the camera can't be used. Without an HTTPS address there is no QR code, and the
 * typed code is for connecting another computer over SSH.
 */
function PairingView({
  pair,
  expires,
  origin,
}: {
  pair: PairingCode;
  expires: number;
  origin: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((expires - now) / 1000));
  const remaining = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  if (!pair.qr)
    return (
      <div className="remote-pair px-5 py-4">
        <TypedCode pair={pair} origin={origin} />
        <p className="task-muted">
          Enter it where you connect this computer. It works once and expires in {remaining}.
        </p>
      </div>
    );
  return (
    <div className="remote-pair remote-pair-hero px-5 py-4">
      <PairingQr rows={pair.qr} />
      <p>Scan this with the Jackalope app on your phone.</p>
      <p className="task-muted">Works once · expires in {remaining}</p>
      <Disclosure className="remote-pair-manual">
        <DisclosureSummary>Can't scan? Enter a code</DisclosureSummary>
        <DisclosureBody>
          <TypedCode pair={pair} origin={origin} />
        </DisclosureBody>
      </Disclosure>
    </div>
  );
}
export function RemoteAccess() {
  const projects = useProjectStore((state) => state.projects);
  const [status, setStatus] = useState<Status | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [port, setPort] = useState(9472);
  const [address, setAddress] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pair, setPair] = useState<PairingCode | null>(null);
  const [expires, setExpires] = useState(0);
  const pairingDevices = useRef(new Set<string>());
  const apply = useCallback((next: Status) => {
    setStatus(next);
    // Before remote access is first turned on, every project starts selected.
    setSelected(
      next.enabled || next.projectIds.length
        ? next.projectIds
        : useProjectStore.getState().projects.map((project) => project.id),
    );
    setPort(next.port);
    setAddress(next.publicOrigin);
    setEnabled(next.enabled);
  }, []);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const next = await invokeNative<Status>('remote_status');
        if (!signal?.aborted) {
          apply(next);
          setError('');
        }
      } catch (cause) {
        if (!signal?.aborted) setError(String(cause));
      }
    },
    [apply],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    if (!status?.listening || busy) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const next = await invokeNative<Status>('remote_status');
          if (alive) setStatus(next);
        } catch (cause) {
          if (alive) setError(String(cause));
        }
      }
      if (alive) timer = setTimeout(poll, 4000);
    };
    timer = setTimeout(poll, 4000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [busy, status?.listening]);
  useEffect(() => {
    if (!pair) return;
    const connected = status?.devices.find((device) => !pairingDevices.current.has(device.id));
    if (connected) {
      setPair(null);
      setNotice(`${connected.name} paired.`);
      return;
    }
    const timer = setTimeout(() => setPair(null), Math.max(0, expires - Date.now()));
    return () => clearTimeout(timer);
  }, [expires, pair, status?.devices]);
  const perform = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const configure = async (allow: boolean) => {
    const templates: RunRequest[] = projects
      .filter((p) => selected.includes(p.id))
      .map((project) => {
        const agent = project.preferences?.preferredRunner || 'auto';
        return {
          id: crypto.randomUUID(),
          projectId: project.id,
          projectName: project.name,
          projectPath: project.path,
          agent,
          agentProfileId: agentAccountFor(project, agent),
          isolated: true,
          prompt: project.preferences?.customInstructions || '',
          targetBranch: project.preferences?.baseBranch || project.gitBranch,
          verifyCommand: project.preferences?.verifyCommand,
          prepareCommand: project.preferences?.prepareCommand,
          setupFiles: project.preferences?.setupFiles,
          autoVerify: project.preferences?.autoVerify ?? true,
        };
      });
    const next = await invokeNative<Status>('remote_configure', {
      enabled: allow,
      port,
      publicOrigin: address,
      projects: templates,
    });
    apply(next);
    setPair(null);
    return next;
  };
  const createPairing = async (devices: Status['devices']) => {
    const result = await invokeNative<PairingCode>('remote_pairing');
    pairingDevices.current = new Set(devices.map((device) => device.id));
    setPair(result);
    setExpires(Date.now() + result.expiresIn * 1000);
  };
  return (
    <SettingGroup title="Remote access">
      {status && !status.enabled && projects.length > 0 && (
        <Setting
          title="Pair a phone"
          description="Turns on remote access. Your phone can read work, start tasks and respond in the projects selected below."
        >
          <Button
            disabled={busy || !selected.length}
            onClick={() =>
              void perform(async () => {
                const next = await configure(true);
                if (next.listening && next.publicOrigin) await createPairing(next.devices);
                else if (next.listening)
                  setNotice('Remote access is on. Set up private HTTPS below to pair a phone.');
              })
            }
          >
            Pair a phone
          </Button>
        </Setting>
      )}
      <form
        className="remote-setup px-5 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            await configure(enabled);
            setNotice('Remote access saved.');
          });
        }}
      >
        <label className="remote-project">
          <Checkbox
            disabled={busy || !status}
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Allow paired devices
        </label>
        <p className="task-muted">
          Paired devices can read work, start tasks and respond for the projects you choose. Keep
          Jackalope running on this host.
        </p>
        <fieldset disabled={busy || !status}>
          <legend>Projects</legend>
          {projects.map((project) => (
            <label className="remote-project" key={project.id}>
              <Checkbox
                checked={selected.includes(project.id)}
                onChange={(event) =>
                  setSelected((ids) =>
                    event.target.checked
                      ? [...ids, project.id]
                      : ids.filter((id) => id !== project.id),
                  )
                }
              />
              {project.name}
            </label>
          ))}
          {!projects.length && <p>Add a project before enabling remote access.</p>}
        </fieldset>
        <Disclosure>
          <DisclosureSummary>Advanced</DisclosureSummary>
          <div className="space-y-3 pt-3">
            <FormField label="Local port">
              <Input
                type="number"
                disabled={busy || !status}
                min={1024}
                max={65535}
                required
                value={port}
                onChange={(event) => setPort(Number(event.target.value))}
              />
            </FormField>
            <FormField
              label="HTTPS address"
              description="Your own HTTPS address, such as a reverse proxy. Leave blank to set up Tailscale below. SSH connections use the local port."
            >
              <Input
                type="url"
                disabled={busy || !status}
                placeholder="https://your-host"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            </FormField>
          </div>
        </Disclosure>
        <Button
          type="submit"
          disabled={!status || busy || (enabled && !selected.length)}
          loading={busy}
          loadingLabel="Saving…"
        >
          Save
        </Button>
      </form>
      {status?.error && <InlineNotice tone="error">{status.error}</InlineNotice>}
      {status?.listening && !status.publicOrigin && (
        <TailscaleSetup
          turnOn={async () => {
            apply(await invokeNative<Status>('remote_private_https'));
            setPair(null);
            setNotice('Private HTTPS is on. Create a pairing code for your phone.');
          }}
        />
      )}
      {status?.listening && (
        <Setting
          title="Pair a device"
          description={
            status.publicOrigin
              ? `Ready for phones at ${status.publicOrigin}.`
              : 'Other computers can pair over SSH now. Phones need the setup above first.'
          }
        >
          <Button
            variant={pair ? 'outline' : 'primary'}
            disabled={busy}
            onClick={() => void perform(() => createPairing(status.devices))}
          >
            {pair ? 'New code' : status.publicOrigin ? 'Pair a phone' : 'Create pairing code'}
          </Button>
        </Setting>
      )}
      {pair && (
        <PairingView
          key={pair.code}
          pair={pair}
          expires={expires}
          origin={status?.publicOrigin ?? ''}
        />
      )}
      {!!status?.devices.length && (
        <div>
          {status.devices.map((device) => (
            <Setting
              key={device.id}
              title={device.name}
              description={`Paired ${new Date(device.pairedAt).toLocaleDateString()}`}
            >
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await invokeNative('remote_revoke', { id: device.id });
                    setStatus(await invokeNative<Status>('remote_status'));
                  })
                }
              >
                Revoke access
              </Button>
            </Setting>
          ))}
        </div>
      )}
      {error && (
        <InlineNotice tone="error" className="mx-5 my-4">
          {error}
          {!status && (
            <Button variant="ghost" onClick={() => void load()}>
              Retry
            </Button>
          )}
        </InlineNotice>
      )}
      {notice && (
        <p role="status" className="task-muted px-5 py-4">
          {notice}
        </p>
      )}
    </SettingGroup>
  );
}
