import {
  Button,
  Checkbox,
  CopyButton,
  Disclosure,
  DisclosureSummary,
  FormField,
  Input,
} from '@jackalope/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { nativeTask, type RunRequest } from '../../lib/task-runtime';
import { syncAgentConfig } from '../../stores/agentConfigStore';
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
/** The pairing code large enough to type from across a desk, with time left and copy. */
function PairingCodeView({ pair, expires }: { pair: PairingCode; expires: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((expires - now) / 1000));
  return (
    <div className="remote-pair px-5 py-4">
      {pair.qr && <PairingQr rows={pair.qr} />}
      <div className="remote-pair-code">
        <span className="task-muted">Pairing code</span>
        <output className="remote-code" aria-label={`Pairing code ${[...pair.code].join(' ')}`}>
          {pair.code}
        </output>
        <p className="task-muted">
          {pair.qr
            ? "Scan the QR code with the Jackalope app, or type the code with this computer's address."
            : 'Type the code where you connect this computer.'}{' '}
          It works once and expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}.
        </p>
        <div className="remote-toolbar">
          <CopyButton size="sm" variant="outline" text={pair.code} label="Copy code" />
          {pair.link && (
            <CopyButton size="sm" variant="outline" text={pair.link} label="Copy phone link" />
          )}
        </div>
      </div>
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
    setSelected(next.projectIds);
    setPort(next.port);
    setAddress(next.publicOrigin);
    setEnabled(next.enabled);
  }, []);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const next = await nativeTask<Status>('remote_status');
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
          const next = await nativeTask<Status>('remote_status');
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
  return (
    <SettingGroup title="Remote access">
      <form
        className="remote-setup px-5 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            await syncAgentConfig();
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
            apply(
              await nativeTask<Status>('remote_configure', {
                enabled,
                port,
                publicOrigin: address,
                projects: templates,
              }),
            );
            setPair(null);
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
          <DisclosureSummary>Connection settings</DisclosureSummary>
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
              description="For an existing Tailscale Serve or HTTPS reverse proxy. SSH connections use the local port."
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
      {status?.listening && (
        <Setting
          title="Pair a device"
          description={
            status.publicOrigin
              ? `Phones and other computers connect at ${status.publicOrigin}.`
              : 'Other computers can pair over SSH now. Phones need private HTTPS, set up below.'
          }
        >
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const result = await nativeTask<PairingCode>('remote_pairing');
                  pairingDevices.current = new Set(status.devices.map((device) => device.id));
                  setPair(result);
                  setExpires(Date.now() + result.expiresIn * 1000);
                })
              }
            >
              Create pairing code
            </Button>
          </div>
        </Setting>
      )}
      {pair && <PairingCodeView key={pair.code} pair={pair} expires={expires} />}
      {status?.listening && !status.publicOrigin && (
        <TailscaleSetup
          turnOn={async () => {
            apply(await nativeTask<Status>('remote_private_https'));
            setPair(null);
            setNotice('Private HTTPS is on. Create a pairing code for your phone.');
          }}
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
                    await nativeTask('remote_revoke', { id: device.id });
                    setStatus(await nativeTask<Status>('remote_status'));
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
