import { Badge, FormField, Input } from '@jackalope/ui';
import { useCallback, useEffect, useState } from 'react';
import {
  addCloudMachine,
  type CloudMachine,
  type ComputerPreferences,
  type ComputerStatus,
  cloudMachines,
  computerPreferences,
  computerStateLabel,
  computerUsage,
  type DockerStatus,
  deleteComputer,
  dockerStatus,
  listComputers,
  providerLabel,
  removeCloudMachine,
  setComputerPreferences,
  stopComputer,
  testCloudMachine,
} from '../../lib/computers';
import { isTauriEnvironment, openExternalUrl } from '../../lib/tauri-bridge';
import { IdleStopSelect } from '../computers/IdleStopSelect';
import { Button } from '../ui/button';
import { ConfirmAction } from '../ui/ConfirmAction';
import { InlineNotice } from '../ui/InlineNotice';
import { Switch } from '../ui/Switch';
import { Setting, SettingBody, SettingGroup } from './Setting';

function dockerSummary(status: DockerStatus) {
  const engine =
    status.engine === 'colima'
      ? 'Colima'
      : status.engine === 'docker-desktop'
        ? 'Docker Desktop'
        : 'Docker';
  return `${engine} ${status.serverVersion ?? ''}${status.arch ? ` · ${status.arch}` : ''}`.trim();
}

/** Docker readiness, paired cloud machines and every bot or task computer. */
export function ComputersSettings() {
  const [docker, setDocker] = useState<DockerStatus | null>(null);
  const [machines, setMachines] = useState<CloudMachine[]>([]);
  const [hosted, setHosted] = useState(false);
  const [computers, setComputers] = useState<ComputerStatus[]>([]);
  const [preferences, setPreferences] = useState<ComputerPreferences | null>(null);
  const [health, setHealth] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: '', url: '', secret: '', viewerUrl: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!isTauriEnvironment()) return;
    const [nextDocker, nextMachines, nextComputers, nextPreferences] = await Promise.all([
      dockerStatus(),
      cloudMachines(),
      listComputers(),
      computerPreferences(),
    ]);
    setPreferences(nextPreferences);
    setDocker(nextDocker);
    setMachines(nextMachines.machines);
    setHosted(nextMachines.hostedAvailable);
    setComputers(nextComputers);
  }, []);

  useEffect(() => {
    void refresh().catch((cause) => setError(String(cause)));
  }, [refresh]);

  // Keep idle countdowns and starting phases current.
  const live = computers.some((computer) => ['running', 'starting'].includes(computer.state));
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(
      () => void listComputers().then(setComputers, () => undefined),
      15_000,
    );
    return () => window.clearInterval(timer);
  }, [live]);

  const replace = (next: ComputerStatus) =>
    setComputers((current) => current.map((item) => (item.id === next.id ? next : item)));

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

  const test = (machine: CloudMachine) =>
    run(`test:${machine.id}`, async () => {
      const result = await testCloudMachine(machine.id);
      setHealth((current) => ({
        ...current,
        [machine.id]: result.reachable
          ? `Connected${result.screen ? ` · ${result.screen[0]}×${result.screen[1]} screen` : ''}`
          : (result.message ?? 'Not reachable'),
      }));
    });

  return (
    <>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <SettingGroup
        title="Local sandboxes"
        description="Bots and tasks can get their own Linux desktop with a browser, running in Docker on this device. Jackalope never installs Docker for you."
      >
        <Setting
          title={
            docker
              ? docker.available
                ? dockerSummary(docker)
                : 'Docker unavailable'
              : 'Checking Docker…'
          }
          description={
            docker?.message ?? (docker?.available ? 'Ready for local sandboxes.' : undefined)
          }
        >
          <div className="flex gap-2">
            {docker?.installUrl && (
              <Button
                variant="outline"
                onClick={() => void openExternalUrl(docker.installUrl ?? '')}
              >
                Get Docker
              </Button>
            )}
            <Button
              variant="outline"
              loading={busy === 'docker'}
              loadingLabel="Checking…"
              disabled={!!busy}
              onClick={() => void run('docker', async () => setDocker(await dockerStatus()))}
            >
              Check again
            </Button>
          </div>
        </Setting>
        <Setting
          title="Keep computers running when Jackalope quits"
          description="Off stops every local sandbox when Jackalope quits; their files are kept. Each sandbox also stops after its idle time, set per computer below or in its bot's settings."
        >
          <Switch
            label="Keep computers running when Jackalope quits"
            checked={preferences?.keepRunningOnQuit ?? false}
            disabled={!preferences}
            onCheckedChange={(keepRunningOnQuit) =>
              void setComputerPreferences({ keepRunningOnQuit }).then(setPreferences, (cause) =>
                setError(String(cause)),
              )
            }
          />
        </Setting>
      </SettingGroup>

      <SettingGroup
        title="Cloud machines"
        description="Bring your own machine from any cloud provider: run the Jackalope computer image there behind HTTPS and pair it with its secret. The secret is kept in this device's protected storage. Jackalope never stops a cloud machine; its provider's own schedule applies."
      >
        {machines.map((machine) => (
          <Setting
            key={machine.id}
            title={machine.name}
            description={health[machine.id] ?? machine.url}
          >
            <div className="flex gap-2">
              <Button
                variant="outline"
                loading={busy === `test:${machine.id}`}
                loadingLabel="Testing…"
                disabled={!!busy}
                onClick={() => void test(machine)}
              >
                Test connection
              </Button>
              <ConfirmAction
                trigger={
                  <Button variant="outline" disabled={!!busy}>
                    Remove…
                  </Button>
                }
                title={`Remove ${machine.name}?`}
                description="Jackalope forgets this machine and its pairing secret. The machine keeps running where it is."
                label="Remove machine"
                busyLabel="Removing…"
                onConfirm={() => run(`remove:${machine.id}`, () => removeCloudMachine(machine.id))}
              />
            </div>
          </Setting>
        ))}
        <SettingBody>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run('add', async () => {
                await addCloudMachine(
                  form.name,
                  form.url,
                  form.secret,
                  form.viewerUrl.trim() || null,
                );
                setForm({ name: '', url: '', secret: '', viewerUrl: '' });
              });
            }}
          >
            <FormField label="Name">
              <Input
                value={form.name}
                maxLength={80}
                placeholder="Research VM"
                disabled={!!busy}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </FormField>
            <FormField label="Agent address">
              <Input
                required
                type="url"
                spellCheck={false}
                placeholder="https://computer.example.com"
                value={form.url}
                disabled={!!busy}
                onChange={(event) => setForm({ ...form, url: event.target.value })}
              />
            </FormField>
            <FormField
              label="Pairing secret"
              description="The JACKALOPE_COMPUTER_TOKEN you set on the machine, at least 32 characters."
            >
              <Input
                required
                type="password"
                autoComplete="off"
                value={form.secret}
                disabled={!!busy}
                onChange={(event) => setForm({ ...form, secret: event.target.value })}
              />
            </FormField>
            <FormField
              label="Viewer address"
              description="Optional. Its noVNC page, opened in your browser for Watch / take over."
            >
              <Input
                type="url"
                spellCheck={false}
                value={form.viewerUrl}
                disabled={!!busy}
                onChange={(event) => setForm({ ...form, viewerUrl: event.target.value })}
              />
            </FormField>
            <Button
              type="submit"
              loading={busy === 'add'}
              loadingLabel="Checking…"
              disabled={!!busy || !form.url.trim() || !form.secret.trim()}
            >
              Pair machine
            </Button>
          </form>
        </SettingBody>
        <Setting
          title={
            <span className="inline-flex items-center gap-2">
              Jackalope-hosted computers {!hosted && <Badge>Coming soon</Badge>}
            </span>
          }
          description="Computers Jackalope runs for you, without Docker or your own cloud account."
        />
      </SettingGroup>

      <SettingGroup title="Computers" description="Every bot and task computer on this device.">
        {computers.length === 0 && (
          <SettingBody>
            <p className="settings-section-subtitle">
              No computers yet. Give a bot one in its settings under Computer.
            </p>
          </SettingBody>
        )}
        {computers.map((computer) => (
          <Setting
            key={computer.id}
            title={
              <span className="inline-flex items-center gap-2">
                {computer.name}
                <Badge variant={computer.state === 'running' ? 'accent' : 'default'}>
                  {computerStateLabel(computer)}
                </Badge>
              </span>
            }
            description={[
              computerUsage(computer),
              providerLabel(computer.provider),
              computer.ownerKind === 'bot' ? 'Bot' : 'Task',
              computer.error,
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            <div className="flex flex-wrap gap-2">
              {computer.provider === 'local-docker' && (
                <IdleStopSelect computer={computer} disabled={!!busy} onChanged={replace} />
              )}
              {computer.state === 'running' && computer.provider === 'local-docker' && (
                <Button
                  variant="outline"
                  loading={busy === `stop:${computer.id}`}
                  loadingLabel="Stopping…"
                  disabled={!!busy}
                  onClick={() => void run(`stop:${computer.id}`, () => stopComputer(computer.id))}
                >
                  Stop
                </Button>
              )}
              <ConfirmAction
                trigger={
                  <Button variant="outline" disabled={!!busy || computer.state === 'starting'}>
                    Delete…
                  </Button>
                }
                title={`Delete ${computer.name}?`}
                description={
                  computer.provider === 'remote-machine'
                    ? 'The bot stops using this machine. Nothing on the machine is deleted.'
                    : 'Its desktop, files and browser sign-ins are removed. This cannot be undone.'
                }
                label="Delete computer"
                busyLabel="Deleting…"
                onConfirm={() => run(`delete:${computer.id}`, () => deleteComputer(computer.id))}
              />
            </div>
          </Setting>
        ))}
      </SettingGroup>
    </>
  );
}
