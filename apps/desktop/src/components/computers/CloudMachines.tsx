import { describeError } from '@jackalope/contracts/errors';
import {
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu as Menu,
  SettingBody,
  SettingGroup,
  SettingRow,
} from '@jackalope/ui';
import { Cloud } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  type CloudMachine,
  cloudMachines,
  describePlatform,
  removeCloudMachine,
  testCloudMachine,
} from '../../lib/computers';
import { isTauriEnvironment } from '../../lib/native/env';
import { useDevicesStore } from '../../stores/devicesStore';
import { ActionError } from '../ui/ActionError';
import { OptionsMenu } from '../ui/OptionsMenu';
import { PairMachineForm } from './PairMachineForm';

/** Machines the person runs behind HTTPS for bots and tasks, and Jackalope-hosted ones. */
export function CloudMachines() {
  const [machines, setMachines] = useState<CloudMachine[]>([]);
  const [hosted, setHosted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [health, setHealth] = useState<Record<string, string>>({});
  const [pairing, setPairing] = useState(false);
  const [removing, setRemoving] = useState<CloudMachine | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const intent = useDevicesStore((state) => state.intent);
  const changed = useDevicesStore((state) => state.changed);

  const refresh = useCallback(async () => {
    if (!isTauriEnvironment()) return;
    const next = await cloudMachines();
    setMachines(next.machines);
    setHosted(next.hostedAvailable);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh().catch((cause) => setError(describeError(cause)));
  }, [refresh]);

  useEffect(() => {
    if (intent === 'add-machine' && useDevicesStore.getState().consume('add-machine'))
      setPairing(true);
  }, [intent]);

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
          ? [
              'Connected',
              result.platform && describePlatform(result.platform),
              result.screen && `${result.screen[0]}×${result.screen[1]} screen`,
            ]
              .filter(Boolean)
              .join(' · ')
          : (result.message ?? 'Not reachable'),
      }));
      if (result.platform) {
        setMachines((current) =>
          current.map((saved) =>
            saved.id === machine.id ? { ...saved, ...result.platform } : saved,
          ),
        );
      }
    });

  return (
    <>
      <ActionError error={error} />
      <SettingGroup
        title="Your cloud machines"
        description="Run the Jackalope computer on any machine you own behind HTTPS, for bots and tasks. Jackalope never stops it; your provider’s schedule applies."
        action={
          !pairing && (
            <Button disabled={!!busy || !loaded} onClick={() => setPairing(true)}>
              Pair a machine
            </Button>
          )
        }
      >
        {loaded && !machines.length && !pairing && (
          <SettingBody>
            <p className="devices-empty">
              <Cloud size={16} aria-hidden="true" />
              No cloud machines yet. Pair one to give bots and tasks a computer that stays on.
            </p>
          </SettingBody>
        )}
        {machines.map((machine) => (
          <SettingRow
            key={machine.id}
            title={machine.name}
            description={health[machine.id] ?? `${describePlatform(machine)} · ${machine.url}`}
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
              <OptionsMenu label={`${machine.name} options`} disabled={!!busy}>
                <Menu.Item className="workspace-menu-item" onSelect={() => setRemoving(machine)}>
                  Remove…
                </Menu.Item>
              </OptionsMenu>
            </div>
          </SettingRow>
        ))}
        {pairing && (
          <SettingBody>
            <PairMachineForm
              defaultName={`Cloud machine ${machines.length + 1}`}
              onCancel={() => setPairing(false)}
              onPaired={() => {
                setPairing(false);
                changed();
                void refresh().catch((cause) => setError(describeError(cause)));
              }}
            />
          </SettingBody>
        )}
      </SettingGroup>
      <SettingGroup
        title={
          <span className="inline-flex items-center gap-2">
            Jackalope-hosted computers {!hosted && <Badge>Coming soon</Badge>}
          </span>
        }
        description="Computers Jackalope runs for you, without Docker or your own cloud account."
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.name ?? 'this machine'}?`}
        description="Jackalope forgets this machine and its pairing secret. The machine keeps running where it is."
        label="Remove machine"
        busyLabel="Removing…"
        onConfirm={async () => {
          if (!removing) return;
          await removeCloudMachine(removing.id);
          setRemoving(null);
          changed();
          await refresh();
        }}
      />
    </>
  );
}
