import { describeError } from '@jackalope/contracts/errors';
import {
  Badge,
  Button,
  ConfirmDialog,
  SettingBody,
  SettingGroup,
  SettingRow,
  Switch,
} from '@jackalope/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { openSettings } from '../../lib/app-events';
import {
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
  setComputerPreferences,
  stopComputer,
} from '../../lib/computers';
import { isTauriEnvironment, openExternalUrl } from '../../lib/native/env';
import { useViewTabStore } from '../../stores/viewTabStore';
import { Agent37Settings } from '../computers/Agent37Connect';
import { AgentSignIns } from '../computers/AgentSignIns';
import { IdleStopSelect } from '../computers/IdleStopSelect';
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

/** Docker readiness, where cloud machines live, and every bot or task computer. */
export function ComputersSettings() {
  const [docker, setDocker] = useState<DockerStatus | null>(null);
  const [machineCount, setMachineCount] = useState<number | null>(null);
  const [computers, setComputers] = useState<ComputerStatus[]>([]);
  const [preferences, setPreferences] = useState<ComputerPreferences | null>(null);
  // The latest preferences, including changes still saving, and the save queue:
  // each save sends every preference as last chosen, one after another.
  const latestPreferences = useRef<ComputerPreferences | null>(null);
  const savedPreferences = useRef<ComputerPreferences | null>(null);
  const savingPreferences = useRef<Promise<void>>(Promise.resolve());
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
    latestPreferences.current = nextPreferences;
    savedPreferences.current = nextPreferences;
    setPreferences(nextPreferences);
    setDocker(nextDocker);
    setMachineCount(nextMachines.machines.length);
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

  const changePreferences = (change: Partial<ComputerPreferences>) => {
    const current = latestPreferences.current;
    if (!current) return;
    const next = { ...current, ...change };
    latestPreferences.current = next;
    setPreferences(next);
    savingPreferences.current = savingPreferences.current.then(() =>
      setComputerPreferences(next).then(
        (saved) => {
          savedPreferences.current = saved;
          if (latestPreferences.current === next) {
            latestPreferences.current = saved;
            setPreferences(saved);
          }
        },
        (cause) => {
          setError(describeError(cause));
          // Show what is actually saved, unless a later change is on its way.
          if (latestPreferences.current === next) {
            latestPreferences.current = savedPreferences.current;
            setPreferences(savedPreferences.current);
          }
        },
      ),
    );
  };

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
            onCheckedChange={(keepRunningOnQuit) => changePreferences({ keepRunningOnQuit })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Cloud machines">
        <SettingRow
          title={
            machineCount
              ? `${machineCount} paired ${machineCount === 1 ? 'machine' : 'machines'}`
              : 'Pair and test cloud machines in Devices'
          }
          description="Devices keeps your phone, other computers and cloud machines in one place."
        >
          <Button
            variant="outline"
            onClick={() => {
              useViewTabStore.getState().setDevices('cloud');
              openSettings('Devices');
            }}
          >
            Open Devices
          </Button>
        </SettingRow>
      </SettingGroup>

      <Agent37Settings />

      <AgentSignIns
        keepApiKeysOnDevice={preferences?.keepApiKeysOnDevice ?? false}
        disabled={!preferences}
        onKeepApiKeysOnDeviceChange={(keepApiKeysOnDevice) =>
          changePreferences({ keepApiKeysOnDevice })
        }
      />

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
