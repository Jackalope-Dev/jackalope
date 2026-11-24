import { describeError } from '@jackalope/contracts/errors';
import {
  Badge,
  Button,
  InlineNotice,
  Input,
  SettingBody,
  SettingGroup,
  SettingRow,
  Switch,
} from '@jackalope/ui';
import { useEffect, useState } from 'react';
import { type AgentCredential, agentCredentials, setAgentCredential } from '../../lib/computers';
import { isTauriEnvironment } from '../../lib/native/env';

const HINTS: Record<string, string> = {
  'claude-token':
    'Uses your Claude subscription. Run claude setup-token in a terminal and paste it.',
  'anthropic-key': 'Billed to your Anthropic API account.',
  'openai-key': 'Billed to your OpenAI API account.',
};

interface AgentSignInsProps {
  /** Agents on a computer get a token instead of the API key, which stays here. */
  keepApiKeysOnDevice: boolean;
  disabled: boolean;
  onKeepApiKeysOnDeviceChange: (keep: boolean) => void;
}

/** Sign-ins for agents that run on a project's computer. Saved values are never shown again. */
export function AgentSignIns({
  keepApiKeysOnDevice,
  disabled,
  onKeepApiKeysOnDeviceChange,
}: AgentSignInsProps) {
  const [credentials, setCredentials] = useState<AgentCredential[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    void agentCredentials()
      .then(setCredentials)
      .catch((cause) => setError(describeError(cause)));
  }, []);

  const save = async (id: string, value: string | null) => {
    setBusy(id);
    setError('');
    try {
      setCredentials(await setAgentCredential(id, value));
      setDrafts((current) => ({ ...current, [id]: '' }));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy('');
    }
  };

  return (
    <SettingGroup
      title={
        <span className="inline-flex items-center gap-2">
          Agent sign-ins for computers <Badge variant="accent">Beta</Badge>
        </span>
      }
      description="Agents that run on a project's computer use these instead of this device's accounts."
    >
      {error && (
        <SettingBody>
          <InlineNotice tone="error">{error}</InlineNotice>
        </SettingBody>
      )}
      {credentials.map((credential) => {
        const inputId = `agent-credential-${credential.id}`;
        const draft = drafts[credential.id] ?? '';
        return (
          <SettingRow
            key={credential.id}
            title={
              <span className="inline-flex items-center gap-2">
                {credential.label}
                {credential.saved && <Badge variant="accent">Saved</Badge>}
              </span>
            }
            description={HINTS[credential.id]}
            controlId={inputId}
          >
            {credential.saved ? (
              <Button
                variant="outline"
                loading={busy === credential.id}
                loadingLabel="Removing…"
                disabled={!!busy}
                onClick={() => void save(credential.id, null)}
              >
                Remove
              </Button>
            ) : (
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (draft.trim()) void save(credential.id, draft);
                }}
              >
                <Input
                  id={inputId}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  className="project-setting-input"
                  value={draft}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [credential.id]: event.target.value }))
                  }
                />
                <Button
                  type="submit"
                  variant="outline"
                  loading={busy === credential.id}
                  loadingLabel="Saving…"
                  disabled={!!busy || !draft.trim()}
                >
                  Save
                </Button>
              </form>
            )}
          </SettingRow>
        );
      })}
      <SettingRow
        title="Keep API keys on this device"
        description="Agents on a computer reach Anthropic and OpenAI through this device, so the API key never leaves it. Claude Code sign-in tokens still go to the computer."
      >
        <Switch
          label="Keep API keys on this device"
          checked={keepApiKeysOnDevice}
          disabled={disabled}
          onCheckedChange={onKeepApiKeysOnDeviceChange}
        />
      </SettingRow>
    </SettingGroup>
  );
}
