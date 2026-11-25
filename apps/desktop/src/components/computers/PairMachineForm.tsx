import {
  Button,
  CopyButton,
  Disclosure,
  DisclosureSummary,
  FieldCheck,
  FlowDiagram,
  FormField,
  Input,
  SegmentedControl,
  SetupSteps,
} from '@jackalope/ui';
import { Laptop, Server } from 'lucide-react';
import { useState } from 'react';
import {
  addCloudMachine,
  type CloudMachine,
  cloudMachines,
  macSetupScript,
} from '../../lib/computers';
import { revealInFileManager } from '../../lib/native/env';
import './computers.css';
import { describeError } from '@jackalope/contracts/errors';
import { useNativeResource } from '../../hooks/useNativeResource';
import '../settings/setup-screens.css';

/** The tag of an image built from resources/computer on the machine itself. */
const LOCAL_IMAGE = 'jackalope-computer';

/** 64 hex characters, above the agent's 32-character minimum. */
function newSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Mirrors the cloud machine command in docs/BOT-COMPUTERS.md with the secret and this
 * version's published image filled in.
 */
const runCommand = (secret: string, image: string) =>
  `docker run -d --name jackalope-computer --init --restart unless-stopped --cap-drop ALL --security-opt no-new-privileges --shm-size 1g -e JACKALOPE_COMPUTER_TOKEN=${secret} -v jackalope-home:/home/bot -p 127.0.0.1:8765:8765 -p 127.0.0.1:6080:6080 ${image}`;

/** Mirrors the Mac setup in docs/BOT-COMPUTERS.md (script from `computers/mac.rs`). */
const macCommand = (secret: string) =>
  `JACKALOPE_COMPUTER_TOKEN=${secret} sh jackalope-mac-computer.sh`;
const MAC_HTTPS = 'tailscale serve --bg 8765';

type MachineKind = 'linux' | 'mac';
const KINDS = [
  { id: 'linux', label: 'Linux with Docker' },
  { id: 'mac', label: 'Mac' },
] as const;

/**
 * Pairs a cloud machine the person runs. The secret is generated here so the start
 * command can be copied as is; it is kept in protected storage once paired.
 */
export function PairMachineForm({
  defaultName,
  onPaired,
  onCancel,
}: {
  defaultName: string;
  onPaired: (machine: CloudMachine) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState(newSecret);
  const [viewerUrl, setViewerUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // This version's published image; a locally built one when it is unknown.
  const image = useNativeResource(cloudMachines, []).data?.image || LOCAL_IMAGE;
  const [kind, setKind] = useState<MachineKind>('linux');
  const [script, setScript] = useState('');
  const [saving, setSaving] = useState(false);
  const command = kind === 'mac' ? macCommand(secret.trim()) : runCommand(secret.trim(), image);
  const [started, setStarted] = useState(false);
  const [paired, setPaired] = useState(false);
  const address = url.trim();
  const httpsAddress = /^https:\/\/[^\s/]+/i.test(address);
  const shown = name.trim() || defaultName;
  const flow = busy ? 'checking' : paired ? 'connected' : error ? 'failed' : 'idle';
  return (
    <form
      className="settings-setup-flow"
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (busy) return;
        setBusy(true);
        setError('');
        try {
          const machine = await addCloudMachine(
            shown,
            url,
            secret.trim(),
            kind === 'linux' ? viewerUrl.trim() || null : null,
          );
          setPaired(true);
          onPaired(machine);
        } catch (cause) {
          setError(describeError(cause));
        } finally {
          setBusy(false);
        }
      }}
    >
      <FlowDiagram
        from={{ label: 'This Mac', icon: <Laptop size={16} /> }}
        to={{ label: shown, icon: <Server size={16} /> }}
        via="HTTPS"
        state={flow}
        error={flow === 'failed' ? error : undefined}
      />
      <SegmentedControl
        label="Machine type"
        items={KINDS}
        value={kind}
        onChange={(next) => {
          setKind(next);
          setStarted(false);
          setError('');
        }}
      />
      <SetupSteps
        label="Pair a cloud machine"
        steps={[
          {
            id: 'start',
            title:
              kind === 'mac'
                ? 'Set up the computer on your Mac'
                : 'Start the computer on your machine',
            hint:
              kind === 'mac'
                ? 'Save the setup script, copy it to the Mac and run this there. It installs this version’s computer agent and starts it at login. The Mac needs Xcode for iOS work and Node for agent CLIs.'
                : image === LOCAL_IMAGE
                  ? 'Build the jackalope-computer image first, then run this and put HTTPS in front of port 8765.'
                  : 'Run this on the machine; Docker downloads the computer image. Then put HTTPS in front of port 8765.',
            state: started ? 'done' : 'current',
            summary: 'Started with the copied command',
            content: (
              <div className="settings-setup-fields">
                {kind === 'mac' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      loading={saving}
                      loadingLabel="Saving…"
                      onClick={async () => {
                        setSaving(true);
                        setError('');
                        try {
                          const path = await macSetupScript();
                          setScript(path);
                          await revealInFileManager(path).catch(() => undefined);
                        } catch (cause) {
                          setError(describeError(cause));
                        } finally {
                          setSaving(false);
                        }
                      }}
                    >
                      Save setup script
                    </Button>
                    {script && <code className="text-xs break-all">{script}</code>}
                  </div>
                )}
                <div className="pair-machine-command">
                  <code>{command}</code>
                  <CopyButton text={command} label="Copy command" variant="outline" size="sm" />
                </div>
                {kind === 'mac' && (
                  <div className="pair-machine-command">
                    <code>{MAC_HTTPS}</code>
                    <CopyButton
                      text={MAC_HTTPS}
                      label="Copy HTTPS command"
                      variant="outline"
                      size="sm"
                    />
                  </div>
                )}
                <div>
                  <Button type="button" variant="secondary" onClick={() => setStarted(true)}>
                    It's running
                  </Button>
                </div>
              </div>
            ),
          },
          {
            id: 'address',
            title: 'Say where it is',
            hint: 'Its HTTPS address, and a name to show here.',
            state: !started ? 'upcoming' : 'current',
            content: (
              <div className="settings-setup-fields">
                <FormField label="Agent address">
                  <Input
                    required
                    type="url"
                    spellCheck={false}
                    placeholder="https://computer.example.com"
                    value={url}
                    disabled={busy}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                </FormField>
                {address && (
                  <FieldCheck tone={httpsAddress ? 'ok' : 'info'}>
                    {httpsAddress
                      ? 'An HTTPS address; pairing checks the computer answers there.'
                      : 'Usually the HTTPS address in front of port 8765, starting with https://.'}
                  </FieldCheck>
                )}
                <FormField label="Name">
                  <Input
                    value={name}
                    maxLength={80}
                    placeholder={defaultName}
                    disabled={busy}
                    onChange={(event) => setName(event.target.value)}
                  />
                </FormField>
                <Disclosure>
                  <DisclosureSummary>
                    {kind === 'mac'
                      ? 'Advanced: pairing secret'
                      : 'Advanced: pairing secret and viewer'}
                  </DisclosureSummary>
                  <div className="settings-setup-fields">
                    <FormField
                      label="Pairing secret"
                      description="Already in the command. Anyone with it can run commands on the machine."
                    >
                      <Input
                        required
                        autoComplete="off"
                        spellCheck={false}
                        className="font-mono"
                        minLength={32}
                        maxLength={512}
                        value={secret}
                        disabled={busy}
                        onChange={(event) => setSecret(event.target.value)}
                      />
                    </FormField>
                    {kind === 'linux' && (
                      <FormField
                        label="Viewer address"
                        description="Optional. Its noVNC page for Watch / take over."
                      >
                        <Input
                          type="url"
                          spellCheck={false}
                          value={viewerUrl}
                          disabled={busy}
                          onChange={(event) => setViewerUrl(event.target.value)}
                        />
                      </FormField>
                    )}
                  </div>
                </Disclosure>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    loading={busy}
                    loadingLabel="Checking…"
                    disabled={busy || !address || secret.trim().length < 32}
                  >
                    Pair machine
                  </Button>
                  <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
                    Cancel
                  </Button>
                </div>
              </div>
            ),
          },
        ]}
      />
    </form>
  );
}
