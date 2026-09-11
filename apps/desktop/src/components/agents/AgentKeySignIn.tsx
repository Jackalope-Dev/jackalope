import { Checkbox, Input } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { type AgentProfile, saveAgentProfileKey } from '../../lib/agent-profiles';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import { useDialogFocus } from '../ui/useDialogFocus';

const providers = [
  ['OPENAI_API_KEY', 'OpenAI'],
  ['ANTHROPIC_API_KEY', 'Anthropic'],
  ['GEMINI_API_KEY', 'Google Gemini'],
  ['OPENROUTER_API_KEY', 'OpenRouter'],
  ['DEEPSEEK_API_KEY', 'DeepSeek'],
  ['XAI_API_KEY', 'xAI'],
  ['GROQ_API_KEY', 'Groq'],
  ['MISTRAL_API_KEY', 'Mistral'],
] as const;

export function AgentKeySignIn({
  agentId,
  agentName,
  profile,
  onSaved,
  onClose,
  returnFocus,
}: {
  agentId: string;
  agentName: string;
  profile: AgentProfile;
  onSaved: (useForTasks: boolean) => Promise<void>;
  onClose: () => Promise<void>;
  returnFocus: HTMLElement | null;
}) {
  const focus = useDialogFocus();
  const antigravity = agentId === 'antigravity';
  const [provider, setProvider] = useState(antigravity ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY');
  const [key, setKey] = useState('');
  const [useForTasks, setUseForTasks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onClose();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content
          {...focus}
          className="task-dialog appearance-panel confirm-action-dialog"
          onCloseAutoFocus={(event) => {
            if (returnFocus?.isConnected) {
              event.preventDefault();
              returnFocus.focus();
            } else focus.onCloseAutoFocus(event);
          }}
        >
          <Dialog.Title className="text-xl font-medium">
            Connect {agentName} · {profile.name}
          </Dialog.Title>
          <Dialog.Description className="task-muted mt-2">
            {antigravity
              ? 'Separate Antigravity accounts use Gemini API keys, with separate API billing. Google subscription logins still use the existing CLI account.'
              : 'Connect a provider API key for this account. Each account keeps its own credentials and provider billing.'}
          </Dialog.Description>
          <form
            className="grid gap-4 mt-4"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError('');
              try {
                await saveAgentProfileKey(agentId, profile.id, provider, key);
                setKey('');
                await onSaved(useForTasks);
                await onClose();
              } catch (error) {
                setError(String(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            {!antigravity && (
              <Select
                aria-label="API provider"
                value={provider}
                onValueChange={setProvider}
                disabled={busy}
              >
                {providers.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </Select>
            )}
            <label className="task-label">
              API key
              <Input
                className="task-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(event) => setKey(event.target.value)}
                required
                disabled={busy}
                maxLength={8192}
              />
            </label>
            <p className="task-muted text-sm">
              Stored locally. Sent only to the selected agent for authentication.
            </p>
            <label className="flex items-center gap-3 min-h-11">
              <Checkbox
                checked={useForTasks}
                onChange={(event) => setUseForTasks(event.target.checked)}
                disabled={busy}
              />
              Use for new tasks
            </label>
            {error && <InlineNotice tone="error">{error}</InlineNotice>}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" disabled={busy} onClick={() => void close()}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !key.trim()}>
                {busy ? 'Saving…' : 'Connect account'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
