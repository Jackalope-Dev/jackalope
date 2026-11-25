import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  Checkbox,
  Choice,
  Disclosure,
  DisclosureSummary,
  InlineNotice,
  LoadingState,
} from '@jackalope/ui';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import {
  attachDevice,
  cancelDeviceRun,
  DEVICE_CHANGED_EVENT,
  DEVICE_RUN_ACTIVE,
  type Device,
  type DeviceAccess,
  type DeviceLevel,
  type DeviceRunState,
  detachDevice,
  deviceAccess,
  deviceRunLabel,
  deviceRunState,
  deviceSummary,
  listDevices,
  runOnDevice,
} from '../../lib/devices';
import './device-panel.css';

/**
 * The conversation's iPhone or iPad: attach one for the agent (see only, or see and
 * control), and build, install and launch the conversation's workspace on it.
 */
export function DevicePanel({
  conversation,
  projectId,
  projectName,
  runId,
}: {
  conversation: string;
  projectId: string;
  projectName: string;
  /** The latest work whose workspace Run on device builds; absent before work starts. */
  runId?: string;
}) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [access, setAccess] = useState<DeviceAccess | null>(null);
  const [run, setRun] = useState<DeviceRunState | null>(null);
  const [selected, setSelected] = useState('');
  const [level, setLevel] = useState<DeviceLevel>('control');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    setDevices(null);
    try {
      setDevices(await listDevices());
    } catch (cause) {
      setDevices([]);
      setError(describeError(cause));
    }
  }, []);

  const reload = useCallback(async () => {
    const [nextAccess, nextRun] = await Promise.all([
      deviceAccess(conversation, projectId),
      deviceRunState(conversation),
    ]);
    setAccess(nextAccess);
    setRun(nextRun);
  }, [conversation, projectId]);

  useEffect(() => {
    void refresh();
    void reload().catch((cause) => setError(describeError(cause)));
  }, [refresh, reload]);

  useTauriEvent<string>(DEVICE_CHANGED_EVENT, (key) => {
    if (key === conversation) void reload().catch(() => {});
  });

  const act = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy('');
    }
  };

  const attached = access?.attached ?? null;
  const target =
    attached?.deviceId ||
    selected ||
    (access?.remembered.length === 1 ? (access.remembered[0]?.deviceId ?? '') : '');
  const targetDevice = devices?.find((device) => device.id === target);
  const running = !!run && DEVICE_RUN_ACTIVE.includes(run.phase);
  const runBlocked = !runId
    ? 'Run on device builds this conversation’s workspace once work has started.'
    : !target
      ? 'Choose a device first.'
      : (targetDevice?.problem ?? null);

  return (
    <div className="device-panel">
      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      {attached ? (
        <div className="device-panel-attached">
          <div>
            <strong>{attached.name}</strong>
            <span>
              {attached.level === 'control'
                ? 'Attached: the agent can install, launch and stop apps and read the console.'
                : 'Attached for seeing only: the agent can list apps and read the console.'}
            </span>
          </div>
          <Button
            variant="outline"
            loading={busy === 'detach'}
            loadingLabel="Detaching…"
            disabled={!!busy}
            onClick={() =>
              void act('detach', async () => setAccess(await detachDevice(conversation, projectId)))
            }
          >
            Detach
          </Button>
        </div>
      ) : (
        <>
          <div className="device-panel-heading">
            <span>Devices paired with this Mac</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh devices"
              disabled={devices === null}
              onClick={() => void refresh()}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </Button>
          </div>
          {devices === null ? (
            <LoadingState compact label="Looking for devices…" />
          ) : devices.length === 0 ? (
            <p className="device-panel-note">
              No iPhone or iPad is paired with this Mac. Connect one with a cable, unlock it and tap
              Trust, then refresh.
            </p>
          ) : (
            <div className="device-panel-list">
              {devices.map((device) => (
                <Choice
                  key={device.id}
                  selected={target === device.id}
                  title={device.name}
                  description={device.problem ?? deviceSummary(device)}
                  onClick={() => setSelected(device.id)}
                />
              ))}
            </div>
          )}
          {!!devices?.length && (
            <>
              <fieldset className="device-panel-levels">
                <legend>The agent may</legend>
                <Choice
                  selected={level === 'control'}
                  title="See and control"
                  description="Install, launch and stop apps, and read the console."
                  onClick={() => setLevel('control')}
                />
                <Choice
                  selected={level === 'see'}
                  title="See only"
                  description="List apps and read the console."
                  onClick={() => setLevel('see')}
                />
              </fieldset>
              <label className="device-panel-remember">
                <Checkbox
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                Always allow this device in {projectName}
              </label>
              <Button
                variant="outline"
                disabled={!target || !!busy}
                loading={busy === 'attach'}
                loadingLabel="Attaching…"
                onClick={() =>
                  void act('attach', async () =>
                    setAccess(
                      await attachDevice({
                        conversation,
                        projectId,
                        deviceId: target,
                        control: level === 'control',
                        remember,
                      }),
                    ),
                  )
                }
              >
                Attach
              </Button>
            </>
          )}
        </>
      )}

      <div className="device-panel-run">
        <div className="device-panel-run-actions">
          <Button
            disabled={!!runBlocked || running || !!busy}
            loading={busy === 'run'}
            loadingLabel="Starting…"
            onClick={() =>
              void act('run', async () => {
                if (!runId || !target) return;
                await runOnDevice(conversation, runId, target);
                setRun(await deviceRunState(conversation));
              })
            }
          >
            Run on device
          </Button>
          {(running || run?.consoleRunning) && (
            <Button variant="outline" onClick={() => void cancelDeviceRun(conversation)}>
              {running ? 'Cancel' : 'Stop console'}
            </Button>
          )}
          {run && (
            <span className="device-panel-phase" aria-live="polite">
              {run.device} · {deviceRunLabel(run.phase)}
            </span>
          )}
        </div>
        {runBlocked && !running && <p className="device-panel-note">{runBlocked}</p>}
        {run?.error && <InlineNotice tone="error">{run.error}</InlineNotice>}
        {run?.phase === 'running' && (
          <>
            <pre className="device-panel-log" role="log" aria-label="App console">
              {run.console.length ? run.console.join('\n') : 'No console output yet.'}
            </pre>
            {run.consoleEnded && <p className="device-panel-note">{run.consoleEnded}</p>}
          </>
        )}
        {!!run?.output.length && (
          <Disclosure open={running || run.phase === 'failed'}>
            <DisclosureSummary>Build output</DisclosureSummary>
            <pre className="device-panel-log">{run.output.join('\n')}</pre>
          </Disclosure>
        )}
      </div>
    </div>
  );
}
