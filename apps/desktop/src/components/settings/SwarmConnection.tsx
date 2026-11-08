import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  FormField,
  InlineNotice,
  Input,
  LinkButton,
  SettingGroup,
  SettingRow,
  Stepper,
} from '@jackalope/ui';
import { useCallback, useEffect, useState } from 'react';
import { cancelCloudflareSignIn, reauthorizeCloudflare } from '../../lib/cloudflare-artifacts';
import { openExternalUrl } from '../../lib/native/env';
import {
  type SwarmConnection as Connection,
  onSwarmSetupProgress,
  removeSwarmConnection,
  type SwarmSetupFailure,
  type SwarmSetupStep,
  saveSwarmConnection,
  setupSwarm,
  swarmConnection,
} from '../../lib/swarm';
import './swarm-connection.css';
import { describeError } from '../../lib/errors';
import { useCloudflareSignIn } from '../../hooks/useCloudflareSignIn';

type Phase = 'allow' | SwarmSetupStep;

const STEPS: { id: Phase; label: string }[] = [
  { id: 'allow', label: 'Allow Workers in Cloudflare' },
  { id: 'account', label: 'Check your Cloudflare account' },
  { id: 'deploy', label: 'Upload the Worker' },
  { id: 'publish', label: 'Publish it on workers.dev' },
  { id: 'verify', label: 'Check that it answers' },
];

interface Run {
  current: Phase;
  /** Whether this run asked Cloudflare for Workers access. */
  allowed: boolean;
  failure?: SwarmSetupFailure | { step: 'allow'; message: string; recovery: null; link: null };
}

function SetupSteps({ run }: { run: Run }) {
  const steps = STEPS.filter((step) => step.id !== 'allow' || run.allowed);
  const at = steps.findIndex((step) => step.id === run.current);
  return (
    <Stepper
      label="Swarm setup"
      steps={steps.map((step, index) => ({
        id: step.id,
        label: step.label,
        state: index < at ? 'done' : index > at ? 'waiting' : run.failure ? 'failed' : 'running',
      }))}
    />
  );
}

/**
 * Connects Jackalope Swarm for cross-machine agent coordination. Set up Swarm deploys
 * the Worker bundled with the app to the connected Cloudflare account; a Worker the
 * person deployed themselves can be entered instead. Swarm builds on Artifacts, so the
 * card stays hidden until Artifacts is connected unless a Worker is already saved.
 */
export function SwarmConnection({ artifactsConnected }: { artifactsConnected: boolean }) {
  const [status, setStatus] = useState<Connection | null>(null);
  const [manual, setManual] = useState(false);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState('');
  const [deleteWorker, setDeleteWorker] = useState(true);
  const [warning, setWarning] = useState('');
  const cloudflareSignIn = useCloudflareSignIn();
  const refresh = useCallback(async () => setStatus(await swarmConnection()), []);
  useEffect(() => {
    void refresh().catch((cause) => setError(describeError(cause)));
  }, [refresh]);
  const open = (link: string) =>
    void openExternalUrl(link).catch((cause) => setError(describeError(cause)));

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      await refresh();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  /** Connect Cloudflare again, asking for Workers access, for the same account. False when canceled. */
  const allowWorkers = async () => {
    if (!(await cloudflareSignIn({ workers: true }))) return false;
    await reauthorizeCloudflare();
    return true;
  };

  const setUp = async (allowFirst = false) => {
    setBusy(true);
    setError('');
    let allowed = allowFirst;
    let state: Run = { current: allowFirst ? 'allow' : 'account', allowed };
    const show = (next: Run) => {
      state = next;
      setRun(next);
    };
    show(state);
    const stop = await onSwarmSetupProgress((step) => show({ ...state, current: step })).catch(
      () => undefined,
    );
    try {
      for (;;) {
        if (state.current === 'allow') {
          try {
            if (!(await allowWorkers())) {
              setRun(null);
              return;
            }
          } catch (cause) {
            show({
              ...state,
              failure: { step: 'allow', message: describeError(cause), recovery: null, link: null },
            });
            return;
          }
          show({ ...state, current: 'account' });
        }
        const result = await setupSwarm();
        if (result.ok) {
          setRun(null);
          setManual(false);
          setStatus(result.connection);
          return;
        }
        // One automatic sign-in per click when Cloudflare needs Workers access.
        if (result.failure.recovery === 'reauthorize' && !allowed) {
          allowed = true;
          show({ current: 'allow', allowed });
          continue;
        }
        show({ ...state, current: result.failure.step, failure: result.failure });
        return;
      }
    } catch (cause) {
      setError(describeError(cause));
      setRun(null);
    } finally {
      stop?.();
      setBusy(false);
    }
  };

  if (!status || (!artifactsConnected && !status.configured && !warning)) return null;
  const failure = run?.failure;
  const updating = Boolean(status.configured && status.managed);

  return (
    <SettingGroup>
      <SettingRow
        title={
          <span className="inline-flex items-center gap-2">
            Jackalope Swarm <Badge variant="accent">Beta</Badge>
          </span>
        }
        description="Gives each agent on an Artifacts project its own fork and flags overlapping edits while they work, even across computers."
      />
      {status.configured ? (
        <SettingRow title="Your swarm Worker" description={status.url}>
          <div className="swarm-actions">
            {status.updateAvailable && (
              <Button
                loading={busy && Boolean(run)}
                loadingLabel="Updating…"
                disabled={busy}
                onClick={() => void setUp()}
              >
                Update Swarm Worker
              </Button>
            )}
            {status.managed ? (
              <ConfirmDialog
                title="Disconnect Jackalope Swarm?"
                description="Agents stop getting forks and overlap warnings on this computer."
                label="Disconnect"
                busyLabel="Disconnecting…"
                onOpenChange={(open) => open && setDeleteWorker(true)}
                onConfirm={async () => {
                  setWarning('');
                  const result = await removeSwarmConnection(deleteWorker);
                  if (result.warning) setWarning(result.warning);
                  await refresh();
                }}
                trigger={
                  <Button variant="outline" disabled={busy}>
                    Disconnect
                  </Button>
                }
              >
                <label className="flex items-start gap-3 min-h-11">
                  <Checkbox
                    className="mt-1"
                    checked={deleteWorker}
                    onChange={(event) => setDeleteWorker(event.target.checked)}
                  />
                  <span>
                    Also delete the Worker from Cloudflare
                    <span className="settings-row-description block">
                      Fork tracking stops on every computer that uses it. Artifacts repositories are
                      not changed.
                    </span>
                  </span>
                </label>
              </ConfirmDialog>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void act(() => removeSwarmConnection())}
              >
                Disconnect
              </Button>
            )}
          </div>
        </SettingRow>
      ) : manual ? (
        <form
          className="space-y-3 px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              await saveSwarmConnection(url.trim(), token.trim());
              setToken('');
              setManual(false);
            });
          }}
        >
          <FormField label="Worker URL">
            <Input
              required
              spellCheck={false}
              placeholder="https://jackalope-swarm.<you>.workers.dev"
              value={url}
              disabled={busy}
              onChange={(event) => setUrl(event.target.value)}
            />
          </FormField>
          <FormField label="Swarm token" description="The Worker's SWARM_TOKEN secret.">
            <Input
              required
              type="password"
              autoComplete="off"
              value={token}
              disabled={busy}
              onChange={(event) => setToken(event.target.value)}
            />
          </FormField>
          <div className="swarm-actions">
            <Button
              type="submit"
              loading={busy}
              loadingLabel="Checking…"
              disabled={busy || !url.trim() || !token.trim()}
            >
              Connect
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setManual(false)}
            >
              Back
            </Button>
          </div>
        </form>
      ) : (
        !run && (
          <SettingRow
            title="Set up Swarm"
            description="Deploys the Swarm Worker to your Cloudflare account and connects it."
          >
            <div className="swarm-actions">
              <Button
                loading={busy}
                loadingLabel="Setting up…"
                disabled={busy}
                onClick={() => void setUp()}
              >
                Set up Swarm
              </Button>
              <LinkButton disabled={busy} onClick={() => setManual(true)}>
                Use an existing Worker
              </LinkButton>
            </div>
          </SettingRow>
        )
      )}
      {run && (
        <div className="swarm-setup px-5 py-4" aria-live="polite">
          <SetupSteps run={run} />
          {failure && (
            <InlineNotice tone="error">
              <span className="swarm-failure">
                {failure.message}
                <span className="swarm-actions">
                  {failure.recovery === 'reauthorize' ? (
                    <Button size="sm" disabled={busy} onClick={() => void setUp(true)}>
                      Allow Workers
                    </Button>
                  ) : (
                    <Button size="sm" disabled={busy} onClick={() => void setUp()}>
                      {updating ? 'Retry update' : 'Retry'}
                    </Button>
                  )}
                  {failure.link && (
                    <LinkButton external onClick={() => failure.link && open(failure.link)}>
                      {failure.recovery === 'token'
                        ? 'Open API tokens'
                        : failure.recovery === 'subdomain'
                          ? 'Choose a subdomain'
                          : 'Open Cloudflare'}
                    </LinkButton>
                  )}
                  {!status.configured && (
                    <LinkButton
                      disabled={busy}
                      onClick={() => {
                        setRun(null);
                        setManual(true);
                      }}
                    >
                      Use an existing Worker
                    </LinkButton>
                  )}
                </span>
              </span>
            </InlineNotice>
          )}
          {busy && run.current === 'allow' && (
            <div className="swarm-actions">
              <span className="settings-row-description">Finish in your browser.</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void cancelCloudflareSignIn().catch(() => {})}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
      {warning && (
        <InlineNotice
          tone="warning"
          className="mx-5 my-4"
          action={
            <Button variant="ghost" onClick={() => setWarning('')}>
              Close
            </Button>
          }
        >
          <span className="swarm-failure">{warning}</span>
        </InlineNotice>
      )}
      {error && (
        <InlineNotice tone="error" className="mx-5 my-4">
          {error}
        </InlineNotice>
      )}
    </SettingGroup>
  );
}
