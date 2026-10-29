import { Badge, FormField, Input, SegmentedControl } from '@jackalope/ui';
import { useCallback, useEffect, useState } from 'react';
import {
  botComputer,
  type CloudMachine,
  type ComputerSettings,
  type ComputerStatus,
  cloudMachines,
  computerStateLabel,
  configureBotComputer,
  DEFAULT_COMPUTER_SETTINGS,
  type DockerStatus,
  deleteComputer,
  dockerStatus,
  providerLabel,
  startComputer,
  stopComputer,
} from '../../lib/computers';
import { isTauriEnvironment, openExternalUrl } from '../../lib/tauri-bridge';
import { Setting, SettingBody, SettingGroup } from '../settings/Setting';
import { Button } from '../ui/button';
import { ConfirmAction } from '../ui/ConfirmAction';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { ComputerViewer } from './ComputerViewer';
import '../settings/settings.css';
import './computers.css';

type Kind = 'none' | 'local-docker' | 'remote-machine';

/** CPU, memory and network for a local sandbox. Changes apply at the next start. */
function Resources({
  settings,
  disabled,
  onChange,
}: {
  settings: ComputerSettings;
  disabled?: boolean;
  onChange: (settings: ComputerSettings) => void;
}) {
  return (
    <>
      <div className="computer-resources">
        <FormField label="CPUs">
          <Input
            type="number"
            min={0.5}
            max={16}
            step={0.5}
            value={settings.cpus}
            disabled={disabled}
            onChange={(event) => onChange({ ...settings, cpus: Number(event.target.value) })}
          />
        </FormField>
        <FormField label="Memory (GB)">
          <Input
            type="number"
            min={1}
            max={64}
            step={1}
            value={settings.memoryMb / 1024}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...settings, memoryMb: Math.round(Number(event.target.value) * 1024) })
            }
          />
        </FormField>
      </div>
      <label className="bot-editor-choice">
        <Switch
          checked={settings.network}
          disabled={disabled}
          onCheckedChange={(network) => onChange({ ...settings, network })}
          aria-describedby="computer-network-help"
        />
        <span>
          <strong>Internet access</strong>
          <small id="computer-network-help">
            Off leaves the computer with no network at all, so you can only follow it in the agent’s
            screenshots and its browser tools stay on this device.
          </small>
        </span>
      </label>
    </>
  );
}

/**
 * A bot's own computer: none, a local Linux sandbox in Docker, or a cloud
 * machine the person paired in Settings → Computers.
 */
export function BotComputerSettings({ bot }: { bot: { id: string; name: string } }) {
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [docker, setDocker] = useState<DockerStatus | null>(null);
  const [machines, setMachines] = useState<CloudMachine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [kind, setKind] = useState<Kind>('none');
  const [machineId, setMachineId] = useState('');
  const [settings, setSettings] = useState<ComputerSettings>(DEFAULT_COMPUTER_SETTINGS);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!isTauriEnvironment()) return;
    try {
      const next = await botComputer(bot.id);
      setStatus(next);
      if (next) setSettings(next.settings);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoaded(true);
    }
  }, [bot.id]);

  useEffect(() => {
    void refresh();
    if (!isTauriEnvironment()) return;
    void dockerStatus()
      .then(setDocker)
      .catch(() => setDocker(null));
    void cloudMachines()
      .then((value) => setMachines(value.machines))
      .catch(() => setMachines([]));
  }, [refresh]);

  // Follow a starting computer until it settles.
  useEffect(() => {
    if (status?.state !== 'starting') return;
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [status?.state, refresh]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError('');
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy('');
    }
  };

  const create = () =>
    run('create', async () => {
      const created = await configureBotComputer(
        bot,
        kind === 'remote-machine' ? 'remote-machine' : 'local-docker',
        kind === 'remote-machine' ? machineId : null,
        settings,
      );
      await startComputer(created.id);
    });

  const description = `A separate machine only ${bot.name} uses, with its own desktop and browser. Its desktop and browser tools act there instead of on your computer, without asking for desktop access. Each website still asks before first use.`;

  if (!loaded && isTauriEnvironment()) {
    return (
      <SettingGroup title="Computer" description={description}>
        <SettingBody>
          <p className="task-muted">Loading…</p>
        </SettingBody>
      </SettingGroup>
    );
  }

  const dockerMissing = docker && !docker.available;

  return (
    <SettingGroup title="Computer" description={description}>
      {error && (
        <SettingBody>
          <InlineNotice tone="error">{error}</InlineNotice>
        </SettingBody>
      )}
      {status ? (
        <>
          <Setting
            title={
              <span className="inline-flex items-center gap-2">
                {status.name}
                <Badge variant={status.state === 'running' ? 'accent' : 'default'}>
                  {computerStateLabel(status)}
                </Badge>
              </span>
            }
            description={
              status.phase ??
              status.error ??
              `${providerLabel(status.provider)}${status.provider === 'local-docker' ? ` · ${status.settings.cpus} CPUs · ${status.settings.memoryMb / 1024} GB` : ''}`
            }
          >
            {status.state === 'running' && status.provider === 'local-docker' ? (
              <Button
                variant="outline"
                loading={busy === 'stop'}
                loadingLabel="Stopping…"
                disabled={!!busy}
                onClick={() => void run('stop', () => stopComputer(status.id))}
              >
                Stop
              </Button>
            ) : status.state !== 'running' ? (
              <Button
                variant="outline"
                loading={busy === 'start' || status.state === 'starting'}
                loadingLabel="Starting…"
                disabled={!!busy || status.state === 'starting'}
                onClick={() => void run('start', () => startComputer(status.id))}
              >
                Start
              </Button>
            ) : null}
          </Setting>
          {status.state === 'running' && (
            <SettingBody>
              <ComputerViewer computer={status} />
            </SettingBody>
          )}
          {status.provider === 'local-docker' && (
            <SettingBody>
              <Resources settings={settings} disabled={!!busy} onChange={setSettings} />
              {JSON.stringify(settings) !== JSON.stringify(status.settings) && (
                <Button
                  variant="outline"
                  className="mt-3"
                  loading={busy === 'save'}
                  loadingLabel="Saving…"
                  disabled={!!busy}
                  onClick={() =>
                    void run('save', () =>
                      configureBotComputer(bot, 'local-docker', null, settings),
                    )
                  }
                >
                  Save resources
                </Button>
              )}
              <p className="form-field-description">
                Changes apply the next time the computer starts. Its files are kept.
              </p>
            </SettingBody>
          )}
          <Setting
            title="Delete computer"
            description={
              status.provider === 'remote-machine'
                ? 'Disconnects the bot from this machine. The machine and its files stay where they run.'
                : 'Removes the computer and everything stored in it, including its browser sign-ins.'
            }
          >
            <ConfirmAction
              trigger={
                <Button variant="outline" disabled={!!busy || status.state === 'starting'}>
                  Delete computer…
                </Button>
              }
              title={`Delete ${status.name}?`}
              description={
                status.provider === 'remote-machine'
                  ? 'The bot stops using this machine. Nothing on the machine is deleted.'
                  : 'Its desktop, files and browser sign-ins are removed. This cannot be undone.'
              }
              label="Delete computer"
              busyLabel="Deleting…"
              onConfirm={async () => {
                setError('');
                try {
                  await deleteComputer(status.id);
                  setStatus(null);
                  setKind('none');
                } catch (cause) {
                  setError(String(cause));
                }
              }}
            />
          </Setting>
        </>
      ) : (
        <SettingBody>
          <SegmentedControl
            label="Computer"
            value={kind}
            onChange={setKind}
            items={[
              { id: 'none', label: 'None' },
              { id: 'local-docker', label: 'Local sandbox' },
              { id: 'remote-machine', label: 'Cloud machine' },
            ]}
          />
          {kind === 'local-docker' && (
            <div className="mt-3 space-y-3">
              {dockerMissing ? (
                <>
                  <InlineNotice tone="warning">{docker.message}</InlineNotice>
                  {docker.installUrl && (
                    <Button
                      variant="outline"
                      onClick={() => void openExternalUrl(docker.installUrl ?? '')}
                    >
                      Get Docker
                    </Button>
                  )}
                </>
              ) : (
                <p className="form-field-description">
                  Runs a Linux desktop with Chromium in Docker on this device. The first start
                  builds its image, which takes a few minutes.
                </p>
              )}
              <Resources settings={settings} disabled={!!busy} onChange={setSettings} />
              <Button
                loading={busy === 'create'}
                loadingLabel="Creating…"
                disabled={!!busy || !!dockerMissing}
                onClick={() => void create()}
              >
                Create and start
              </Button>
            </div>
          )}
          {kind === 'remote-machine' && (
            <div className="mt-3 space-y-3">
              {machines.length ? (
                <>
                  <FormField label="Machine">
                    <Select
                      value={machineId}
                      placeholder="Choose a paired machine"
                      onValueChange={setMachineId}
                    >
                      {machines.map((machine) => (
                        <SelectItem key={machine.id} value={machine.id}>
                          {machine.name}
                        </SelectItem>
                      ))}
                    </Select>
                  </FormField>
                  <Button
                    loading={busy === 'create'}
                    loadingLabel="Connecting…"
                    disabled={!!busy || !machineId}
                    onClick={() => void create()}
                  >
                    Use this machine
                  </Button>
                </>
              ) : (
                <p className="form-field-description">
                  Pair a machine you run in Settings → Computers first.
                </p>
              )}
            </div>
          )}
        </SettingBody>
      )}
    </SettingGroup>
  );
}
