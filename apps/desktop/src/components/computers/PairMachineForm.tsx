import {
  Button,
  CopyButton,
  Disclosure,
  DisclosureSummary,
  FieldCheck,
  FlowDiagram,
  FormField,
  Input,
  SetupSteps,
} from '@jackalope/ui';
import { Laptop, Server } from 'lucide-react';
import { useState } from 'react';
import { addCloudMachine, type CloudMachine, cloudMachines } from '../../lib/computers';
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
  const command = runCommand(secret.trim(), image);
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
            viewerUrl.trim() || null,
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
      <SetupSteps
        label="Pair a cloud machine"
        steps={[
          {
            id: 'start',
            title: 'Start the computer on your machine',
            hint:
              image === LOCAL_IMAGE
                ? 'Build the jackalope-computer image first, then run this and put HTTPS in front of port 8765.'
                : 'Run this on the machine; Docker downloads the computer image. Then put HTTPS in front of port 8765.',
            state: started ? 'done' : 'current',
            summary: 'Started with the copied command',
            content: (
              <div className="settings-setup-fields">
                <div className="pair-machine-command">
                  <code>{command}</code>
                  <CopyButton text={command} label="Copy command" variant="outline" size="sm" />
                </div>
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
                  <DisclosureSummary>Advanced: pairing secret and viewer</DisclosureSummary>
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
