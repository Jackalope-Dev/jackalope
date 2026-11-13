import {
  Button,
  Checkbox,
  ChoiceGrid,
  Disclosure,
  DisclosureSummary,
  FlowDiagram,
  FormField,
  InlineNotice,
  Input,
  SettingGroup,
  SettingRow,
  SetupIntro,
  SetupLayout,
  type SetupStepState,
  SetupSteps,
  SetupSummary,
  Switch,
} from '@jackalope/ui';
import { Laptop, Share2, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { invokeNative } from '../../lib/native/transport';
import { projectNameHints } from '../../lib/project-name-hints';
import { thisComputerLabel } from '../../lib/remote-checks';
import { syncProjectIcons } from '../../lib/remote-project-icons';
import type { RunRequest } from '../../lib/run-types';
import { agentAccountFor, type Project, useProjectStore } from '../../stores/projectStore';
import { ProjectMark } from '../projects/ProjectMark';
import { type PairingCode, PairingView } from '../remote/PairingCode';
import { TailscaleSetup } from './TailscaleSetup';
import '../remote/remote.css';
import { describeError } from '@jackalope/contracts/errors';

interface Status {
  enabled: boolean;
  listening: boolean;
  port: number;
  publicOrigin: string;
  projectIds: string[];
  devices: { id: string; name: string; pairedAt: string; invitedBy?: string | null }[];
  /** Paired computers may ask for a one-time phone pairing code (off by default). */
  allowPhoneInvites?: boolean;
  error: string | null;
}
/** The host part of an HTTPS address, or the address as saved when it doesn't parse. */
function originHost(origin: string) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** How the link to this computer is made, named only from what remote access reports. */
function linkLabel(status: Status | null) {
  if (!status?.listening) return undefined;
  // Without an HTTPS address, other computers reach the local port through an SSH tunnel.
  if (!status.publicOrigin) return 'SSH tunnel';
  return originHost(status.publicOrigin).split(':')[0].endsWith('.ts.net')
    ? 'Tailscale HTTPS'
    : 'HTTPS';
}

/** The shared projects in a few words: all of them, up to two names, or two and a count. */
function sharedProjects(chosen: Project[], total: number, hints: Map<string, string>) {
  if (!chosen.length) return 'No projects chosen';
  if (chosen.length === total && total > 2) return `All ${total} projects`;
  const named = chosen.map((project) =>
    hints.has(project.id) ? `${project.name} (${hints.get(project.id)})` : project.name,
  );
  if (named.length <= 2) return named.join(' and ');
  return `${named.slice(0, 2).join(', ')} and ${named.length - 2} more`;
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
        if (!signal?.aborted) setError(describeError(cause));
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
          if (alive) setError(describeError(cause));
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
      setError(describeError(cause));
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
    // The host keeps icons only for shared projects, so newly shared ones need theirs.
    syncProjectIcons(true);
    return next;
  };
  const createPairing = async (devices: Status['devices']) => {
    const result = await invokeNative<PairingCode>('remote_pairing');
    pairingDevices.current = new Set(devices.map((device) => device.id));
    setPair(result);
    setExpires(Date.now() + result.expiresIn * 1000);
  };
  const hints = projectNameHints(projects);
  const chosen = projects.filter((project) => selected.includes(project.id));
  const shared = sharedProjects(chosen, projects.length, hints);
  // A changed selection only reaches paired devices once saved.
  const projectsChanged =
    Boolean(status?.enabled) &&
    (selected.length !== status?.projectIds.length ||
      selected.some((id) => !status?.projectIds.includes(id)));
  const devices = status?.devices ?? [];
  const pairedSummary = devices.length
    ? `${devices.length} ${devices.length === 1 ? 'device' : 'devices'}: ${devices
        .map((device) => device.name)
        .join(', ')}`
    : 'None yet';
  const done = {
    projects: selected.length > 0,
    on: Boolean(status?.listening),
    phone: Boolean(status?.publicOrigin),
    paired: Boolean(status?.devices.length),
  };
  // HTTPS for phones is optional, so it never holds the current step.
  const required = ['projects', 'on', 'paired'] as const;
  const current = required.find((step) => !done[step]);
  const stepState = (step: keyof typeof done): SetupStepState =>
    done[step] ? 'done' : step === current ? 'current' : 'upcoming';
  const quickPair = status && !status.enabled && projects.length > 0 && (
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
  );
  return (
    // The settings page already titles this category, so the group carries no header.
    <SettingGroup>
      <div className="remote-share px-5 py-4">
        <SetupLayout
          aside={
            <>
              <SetupIntro
                icon={<Share2 size={20} />}
                title="Use this computer from elsewhere"
                description="Paired phones and computers can follow work and answer questions in the projects you share."
                action={quickPair}
              />
              <FlowDiagram
                from={
                  status?.listening && !status.publicOrigin
                    ? { label: 'Another computer', icon: <Laptop size={15} /> }
                    : { label: 'Phone or computer', icon: <Smartphone size={15} /> }
                }
                to={{ label: thisComputerLabel(), icon: <Laptop size={15} /> }}
                via={linkLabel(status)}
                state={
                  busy
                    ? 'checking'
                    : status?.error
                      ? 'failed'
                      : status?.listening
                        ? 'connected'
                        : 'idle'
                }
                error={status?.error}
              />
              <SetupSummary
                label="Sharing so far"
                items={[
                  { label: 'Projects', value: shared },
                  {
                    label: 'Remote access',
                    value: status?.listening
                      ? `On · port ${status.port}`
                      : status?.enabled
                        ? 'Allowed, not listening'
                        : 'Off',
                  },
                  {
                    label: 'Phones',
                    value: status?.publicOrigin ? originHost(status.publicOrigin) : 'Not set up',
                  },
                  { label: 'Paired', value: pairedSummary },
                ]}
              />
            </>
          }
        >
          <SetupSteps
            label="Share this computer"
            steps={[
              {
                id: 'projects',
                title: 'Choose the projects to share',
                hint: 'Paired devices only see and work in these.',
                state: stepState('projects'),
                summary: `Sharing ${shared.charAt(0).toLowerCase()}${shared.slice(1)}`,
                content: projects.length ? (
                  <>
                    <ChoiceGrid
                      label="Projects"
                      values={selected}
                      onValuesChange={setSelected}
                      disabled={busy || !status}
                      options={projects.map((project) => ({
                        value: project.id,
                        title: project.name,
                        description: hints.get(project.id),
                        searchText: `${project.name} ${hints.get(project.id) ?? ''}`,
                        icon: <ProjectMark project={project} />,
                      }))}
                    />
                    {projectsChanged && (
                      <Button
                        className="justify-self-start"
                        disabled={busy || !selected.length}
                        loading={busy}
                        loadingLabel="Saving…"
                        onClick={() =>
                          void perform(async () => {
                            await configure(true);
                            setNotice('Shared projects saved.');
                          })
                        }
                      >
                        Save shared projects
                      </Button>
                    )}
                  </>
                ) : (
                  <p className="task-muted">Add a project before enabling remote access.</p>
                ),
              },
              {
                id: 'on',
                title: 'Turn on remote access',
                hint: 'Other computers can then pair over SSH with a pairing code.',
                state: stepState('on'),
                summary: status?.listening
                  ? `On, listening on port ${status.port}${status.publicOrigin ? ` and at ${status.publicOrigin}` : ''}`
                  : undefined,
                content: (
                  <form
                    className="remote-setup"
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
                    <Disclosure>
                      <DisclosureSummary>Advanced</DisclosureSummary>
                      <div className="space-y-3 pt-3">
                        <FormField label="Local port" className="remote-field-port">
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
                          className="remote-field-address"
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
                ),
              },
              {
                id: 'phone',
                title: 'Reach it from a phone',
                optional: true,
                hint: status?.publicOrigin
                  ? `Ready for phones at ${status.publicOrigin}.`
                  : 'Phones connect over HTTPS. Other computers don’t need this.',
                state: stepState('phone'),
                summary: status?.publicOrigin
                  ? `Phones reach it at ${status.publicOrigin}`
                  : undefined,
                // Optional, so it never becomes current; it opens once remote access is on.
                open: Boolean(status?.listening && !status.publicOrigin),
                content: status?.listening && !status.publicOrigin && (
                  <TailscaleSetup
                    turnOn={async () => {
                      apply(await invokeNative<Status>('remote_private_https'));
                      setPair(null);
                      setNotice('Private HTTPS is on. Create a pairing code for your phone.');
                    }}
                  />
                ),
              },
              {
                id: 'paired',
                title: 'Pair a device',
                hint: status?.listening
                  ? status.publicOrigin
                    ? 'Scan the code with the Jackalope phone app, or type it on another computer.'
                    : 'Type the code on the other computer under Hosts → Connect a host.'
                  : 'Turn on remote access first.',
                state: stepState('paired'),
                summary: devices.length
                  ? `Paired with ${devices.map((device) => device.name).join(', ')}`
                  : undefined,
                editLabel: 'Manage',
                // A code on screen stays open until it's used or expires.
                open: Boolean(pair),
                content: (
                  <>
                    {status?.listening && (
                      <Button
                        className="justify-self-start"
                        variant={pair ? 'outline' : 'primary'}
                        disabled={busy}
                        onClick={() => void perform(() => createPairing(status.devices))}
                      >
                        {pair
                          ? 'New code'
                          : status.publicOrigin
                            ? 'Pair a phone'
                            : 'Create pairing code'}
                      </Button>
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
                      <div className="remote-share-devices">
                        {status.devices.map((device) => (
                          <SettingRow
                            key={device.id}
                            title={device.name}
                            description={`Paired ${new Date(device.pairedAt).toLocaleDateString()}${
                              device.invitedBy ? ` · invited by ${device.invitedBy}` : ''
                            }`}
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
                          </SettingRow>
                        ))}
                      </div>
                    )}
                    {status?.listening && (
                      <Switch
                        label="Let paired computers invite phones"
                        description="A computer paired here can show a one-time code so your phone pairs with this computer directly. Phones a computer invited are removed when you revoke it."
                        checked={Boolean(status.allowPhoneInvites)}
                        disabled={busy}
                        onCheckedChange={(allowed) =>
                          void perform(async () =>
                            setStatus(
                              await invokeNative<Status>('remote_phone_invites', { allowed }),
                            ),
                          )
                        }
                      />
                    )}
                  </>
                ),
              },
            ]}
          />
        </SetupLayout>
      </div>
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
