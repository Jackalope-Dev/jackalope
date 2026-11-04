import { CopyButton, FormField, Input } from '@jackalope/ui';
import { useState } from 'react';
import { addCloudMachine, type CloudMachine } from '../../lib/computers';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import './computers.css';

/** 64 hex characters, above the agent's 32-character minimum. */
function newSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Mirrors the cloud machine command in docs/BOT-COMPUTERS.md with the secret filled in. */
const runCommand = (secret: string) =>
  `docker run -d --name jackalope-computer --init --restart unless-stopped --cap-drop ALL --security-opt no-new-privileges --shm-size 1g -e JACKALOPE_COMPUTER_TOKEN=${secret} -v jackalope-home:/home/bot -p 127.0.0.1:8765:8765 -p 127.0.0.1:6080:6080 jackalope-computer`;

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
  const command = runCommand(secret.trim());
  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (busy) return;
        setBusy(true);
        setError('');
        try {
          onPaired(
            await addCloudMachine(
              name.trim() || defaultName,
              url,
              secret.trim(),
              viewerUrl.trim() || null,
            ),
          );
        } catch (cause) {
          setError(String(cause));
        } finally {
          setBusy(false);
        }
      }}
    >
      <FormField
        label="Start the computer on your machine"
        description="Build the jackalope-computer image first, then put HTTPS in front of port 8765."
      >
        <div className="pair-machine-command">
          <code>{command}</code>
          <CopyButton text={command} label="Copy command" variant="outline" size="sm" />
        </div>
      </FormField>
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
      <FormField label="Name">
        <Input
          value={name}
          maxLength={80}
          placeholder={defaultName}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
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
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          loading={busy}
          loadingLabel="Checking…"
          disabled={busy || !url.trim() || secret.trim().length < 32}
        >
          Pair machine
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
