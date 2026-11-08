import {
  Badge,
  Button,
  ConfirmDialog,
  SettingBody,
  SettingGroup,
  SettingRow,
  Switch,
} from '@jackalope/ui';
import { useCallback, useEffect, useState } from 'react';
import {
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
import { describeError } from '@jackalope/contracts/errors';
import { isTauriEnvironment, openExternalUrl } from '../../lib/native/env';
import { Agent37Settings } from '../computers/Agent37Connect';
import { AgentSignIns } from '../computers/AgentSignIns';
import { IdleStopSelect } from '../computers/IdleStopSelect';
import { PairMachineForm } from '../computers/PairMachineForm';
import { ActionError } from '../ui/ActionError';

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
  const [pairing, setPairing] = useState(false);
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
    void refresh().catch((cause) => setError(describeError(cause)));
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
      setError(describeError(cause));
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
      <ActionError error={error} />
      <SettingGroup
        title="Local sandboxes"
        description="Bots and tasks get their own Linux desktop and browser in Docker on this device."
      >
        <SettingRow
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
        </SettingRow>
        <SettingRow
          title="Keep computers running when Jackalope quits"
          description="When off, local sandboxes stop when Jackalope quits. Their files are kept."
        >
          <Switch
            label="Keep computers running when Jackalope quits"
            checked={preferences?.keepRunningOnQuit ?? false}
            disabled={!preferences}
            onCheckedChange={(keepRunningOnQuit) =>
              void setComputerPreferences({ keepRunningOnQuit }).then(setPreferences, (cause) =>
                setError(describeError(cause)),
              )
            }
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup
        title="Cloud machines"
        description="Run the Jackalope computer on any machine you own behind HTTPS. Jackalope never stops it; your provider’s schedule applies."
      >
        {machines.map((machine) => (
          <SettingRow
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
              <ConfirmDialog
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
          </SettingRow>
        ))}
        {pairing ? (
          <SettingBody>
            <PairMachineForm
              defaultName={`Cloud machine ${machines.length + 1}`}
              onCancel={() => setPairing(false)}
              onPaired={() => {
                setPairing(false);
                void refresh().catch((cause) => setError(describeError(cause)));
              }}
            />
          </SettingBody>
        ) : (
          <SettingRow title="Pair a cloud machine">
            <Button variant="outline" disabled={!!busy} onClick={() => setPairing(true)}>
              Pair machine
            </Button>
          </SettingRow>
        )}
        <SettingRow
          title={
            <span className="inline-flex items-center gap-2">
              Jackalope-hosted computers {!hosted && <Badge>Coming soon</Badge>}
            </span>
          }
          description="Computers Jackalope runs for you, without Docker or your own cloud account."
        />
      </SettingGroup>

      <Agent37Settings />

      <AgentSignIns />

      <SettingGroup
        title="Computers"
        description="Every bot, project and task computer on this device."
      >
        {computers.length === 0 && (
          <SettingBody>
            <p className="settings-section-subtitle">
              No computers yet. Give a bot one in its settings, or choose where a project's agents
              run in Project settings.
            </p>
          </SettingBody>
        )}
        {computers.map((computer) => (
          <SettingRow
            key={computer.id}
            title={
              <span className="inline-flex items-center gap-2">
                {computer.name}
                <Badge variant={computer.state === 'running' ? 'accent' : 'default'}>
                  {computerStateLabel(computer)}
                </Badge>
                {(computer.ownerKind === 'project' || computer.provider === 'agent37') && (
                  <Badge variant="accent">Beta</Badge>
                )}
              </span>
            }
            description={[
              computerUsage(computer),
              providerLabel(computer.provider),
              computer.ownerKind === 'bot'
                ? 'Bot'
                : computer.ownerKind === 'project'
                  ? 'Project agents'
                  : 'Task',
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
              <ConfirmDialog
                trigger={
                  <Button variant="outline" disabled={!!busy || computer.state === 'starting'}>
                    Delete…
                  </Button>
                }
                title={`Delete ${computer.name}?`}
                description={
                  computer.provider === 'remote-machine'
                    ? 'Jackalope stops using this machine. Nothing on the machine is deleted.'
                    : 'Its desktop, files and browser sign-ins are removed. This cannot be undone.'
                }
                label="Delete computer"
                busyLabel="Deleting…"
                onConfirm={() => run(`delete:${computer.id}`, () => deleteComputer(computer.id))}
              />
            </div>
          </SettingRow>
        ))}
      </SettingGroup>
    </>
  );
}
