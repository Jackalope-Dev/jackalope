import { Button, Checkbox, Disclosure, DisclosureSummary, FormField, Input } from '@jackalope/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { nativeTask, type RunRequest } from '../../lib/task-runtime';
import { syncAgentConfig } from '../../stores/agentConfigStore';
import { agentAccountFor, useProjectStore } from '../../stores/projectStore';
import { InlineNotice } from '../ui/InlineNotice';
import { Setting, SettingGroup } from './Setting';
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
  const [pair, setPair] = useState<{ code: string; link: string | null; expiresIn: number } | null>(
    null,
  );
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
              ? 'Open the link on your phone or use the code on another desktop. Links expire after five minutes and work once.'
              : 'Use SSH from another desktop, or enable private HTTPS for your phone.'
          }
        >
          <div className="flex flex-wrap gap-2">
            {!status.publicOrigin && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    apply(await nativeTask<Status>('remote_private_https'));
                    setNotice(
                      'Private HTTPS is ready. Both devices must be signed in to Tailscale.',
                    );
                  })
                }
              >
                Set up with Tailscale
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const result = await nativeTask<{
                    code: string;
                    link: string | null;
                    expiresIn: number;
                  }>('remote_pairing');
                  pairingDevices.current = new Set(status.devices.map((device) => device.id));
                  setPair(result);
                  setExpires(Date.now() + result.expiresIn * 1000);
                })
              }
            >
              {status.publicOrigin ? 'Create pairing link' : 'Create pairing code'}
            </Button>
          </div>
        </Setting>
      )}
      {pair && (
        <div className="remote-toolbar px-5 py-4">
          <Button
            onClick={() =>
              void perform(async () => {
                await navigator.clipboard.writeText(pair.link || pair.code);
                setNotice(
                  pair.link
                    ? 'Pairing link copied. Open it on your phone.'
                    : 'Pairing code copied. Paste it when connecting this host.',
                );
              })
            }
          >
            {pair.link ? 'Copy phone link' : 'Copy pairing code'}
          </Button>
          {pair.link && (
            <Button
              variant="outline"
              onClick={() =>
                void perform(async () => {
                  await navigator.clipboard.writeText(pair.code);
                  setNotice('Pairing code copied.');
                })
              }
            >
              Copy desktop code
            </Button>
          )}
          <span>Expires in five minutes</span>
        </div>
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
