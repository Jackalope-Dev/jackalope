import { Checkbox, Input } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { KeyRound } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ModelCatalog } from '../../lib/agent-models';
import {
  type AgentProfile,
  checkAgentProfile,
  createAgentProfile,
  deleteAgentProfile,
  saveAgentProfileKey,
  setActiveAgentProfile,
} from '../../lib/agent-profiles';
import { type ApiProvider, apiProviders } from '../../lib/api-providers';
import { useManagedRuntime } from '../../lib/managed-runtime';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useAgentAccountsStore } from '../../stores/agentAccountsStore';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import { Button } from '../ui/button';
import { DialogContent, DialogFooter, DialogHeader } from '../ui/Dialog';
import { FormField } from '../ui/FormField';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import { useDialogFocus } from '../ui/useDialogFocus';
import { ManagedRuntimeProgress } from './ManagedRuntimeProgress';

function ConnectProvider({ provider, onClose }: { provider: ApiProvider; onClose: () => void }) {
  const focus = useDialogFocus();
  const runner = useManagedRuntime();
  const [name, setName] = useState(provider.name as string);
  const [key, setKey] = useState('');
  const profile = useRef<AgentProfile | null>(null);
  const saved = useRef(false);
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [model, setModel] = useState('');
  const [useForTasks, setUseForTasks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const models = catalog?.models.filter((model) => model.id.startsWith(`${provider.id}/`)) ?? [];
  const close = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (profile.current && !saved.current)
        await deleteAgentProfile('opencode', profile.current.id);
      await useAgentAccountsStore.getState().load('opencode', true);
      onClose();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const readModels = async () => {
    if (!profile.current) return;
    const result = await nativeTask<ModelCatalog>('agent_models', {
      agent: 'opencode',
      agentProfileId: profile.current.id,
      refresh: true,
    });
    setCatalog(result);
    const available = result.models.filter((model) => model.id.startsWith(`${provider.id}/`));
    setModel(available.find((model) => model.isDefault)?.id ?? available[0]?.id ?? '');
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <DialogContent {...focus} className="confirm-action-dialog">
        <DialogHeader
          title={`Connect ${provider.name}`}
          description={
            <>
              Use your {provider.name} API key. Jackalope downloads its private OpenCode runner on
              first connection (up to 65 MB). API usage is billed by {provider.name}.
            </>
          }
        />
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError('');
            try {
              if (!keySaved) {
                await runner.prepare();
                profile.current ??= await createAgentProfile('opencode', name.trim(), null);
                await saveAgentProfileKey('opencode', profile.current.id, provider.key, key);
                setKey('');
                setKeySaved(true);
                await readModels();
                return;
              }
              if (!catalog || !models.length) {
                await readModels();
                return;
              }
              if (!profile.current || !models.some((item) => item.id === model))
                throw new Error('Choose a discovered model.');
              const status = await checkAgentProfile('opencode', profile.current.id);
              if (status.state !== 'configured' && status.state !== 'signedIn')
                throw new Error(status.detail);
              saved.current = true;
              useAgentAccountsStore.getState().setStatus('opencode', profile.current.id, status);
              if (useForTasks) {
                const config = useAgentConfigStore.getState();
                const options = config.runnerOptions.opencode ?? {
                  models: [],
                  defaultModel: '',
                  restrictModels: false,
                };
                await setActiveAgentProfile('opencode', profile.current.id);
                config.toggleAgent('opencode', true);
                config.setRunnerOptions('opencode', {
                  ...options,
                  defaultModel: model,
                  models: [...new Set([...options.models, model])],
                });
                await syncAgentConfig();
              }
              await useAgentAccountsStore.getState().load('opencode', true);
              await useExecutionStore.getState().discover();
              onClose();
            } catch (cause) {
              setError(String(cause));
            } finally {
              setBusy(false);
            }
          }}
        >
          {!keySaved ? (
            <>
              <FormField label="Account name">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={80}
                  disabled={busy || !!profile.current}
                />
              </FormField>
              <FormField
                label="API key"
                description="Kept in protected local storage for this account."
              >
                <Input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  required
                  maxLength={8192}
                  disabled={busy}
                />
              </FormField>
            </>
          ) : (
            <>
              <p className="task-muted">
                The key is saved. Model access and available credit are checked when a task runs.
              </p>
              {models.length > 0 ? (
                <>
                  <FormField label="Model">
                    <Select
                      aria-label="Provider model"
                      value={model}
                      onValueChange={setModel}
                      disabled={busy}
                    >
                      {models.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.name}
                        </SelectItem>
                      ))}
                    </Select>
                  </FormField>
                  <label className="flex items-center gap-3 min-h-11">
                    <Checkbox
                      checked={useForTasks}
                      onChange={(event) => setUseForTasks(event.target.checked)}
                      disabled={busy}
                    />
                    Use this account and model for new OpenCode tasks
                  </label>
                  {!useForTasks && (
                    <p className="task-muted text-sm">
                      The account will be available in task settings. Existing defaults stay
                      selected.
                    </p>
                  )}
                </>
              ) : (
                <p className="task-muted">
                  No {provider.name} models were returned. Check the installed OpenCode version and
                  provider configuration, then retry.
                </p>
              )}
            </>
          )}
          {runner.preparing && (
            <ManagedRuntimeProgress
              progress={runner.progress}
              onCancel={() => void runner.cancel().catch((cause) => setError(String(cause)))}
            />
          )}
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void close()}>
              {saved.current ? 'Close' : 'Cancel'}
            </Button>
            <Button
              type="submit"
              disabled={busy || (!keySaved && (!key.trim() || !name.trim()))}
              loading={busy}
              loadingLabel="Connecting…"
            >
              {!keySaved
                ? 'Save key & find models'
                : models.length
                  ? 'Finish connection'
                  : 'Retry model discovery'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog.Root>
  );
}

export function ProviderConnections() {
  const [provider, setProvider] = useState<ApiProvider>();
  return (
    <section className="workspace-stack" aria-label="Connect an API provider">
      <div>
        <h2 className="text-base font-medium">Connect an API provider</h2>
        <p className="task-muted">
          Bring your own key for DeepSeek and other providers. No separate OpenCode installation or
          account is needed.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {apiProviders.map((provider) => (
          <Button
            key={provider.id}
            variant="outline"
            disabled={!isTauriEnvironment()}
            onClick={() => setProvider(provider)}
          >
            <KeyRound size={16} /> {provider.name}
          </Button>
        ))}
      </div>
      {provider && (
        <ConnectProvider
          key={provider.id}
          provider={provider}
          onClose={() => setProvider(undefined)}
        />
      )}
    </section>
  );
}
