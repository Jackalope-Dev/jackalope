import { Check, Plus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { Button } from '../ui/button';
import { LoadingState } from '../ui/LoadingState';
import { Select, SelectItem } from '../ui/Select';

interface ModelCatalog {
  models: { id: string; name: string; isDefault: boolean }[];
  source: string;
  account: string | null;
  checkedAt: string;
  detail: string;
}
export function AgentModels({
  agentId,
  revision,
  selected,
  defaultModel,
  restricted,
  onChange,
}: {
  agentId: string;
  revision: number;
  selected: string[];
  defaultModel: string;
  restricted: boolean;
  onChange: (patch: { models?: string[]; defaultModel?: string }) => void;
}) {
  const modelSelectId = useId();
  const [showAll, setShowAll] = useState(false);
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const request = useRef(0);
  const refresh = useCallback(
    async (force = false) => {
      if (!isTauriEnvironment()) {
        setLoading(false);
        return;
      }
      const version = ++request.current;
      setLoading(true);
      setError('');
      try {
        const result = await nativeTask<ModelCatalog>('agent_models', {
          agent: agentId,
          refresh: force,
        });
        if (version === request.current) setCatalog(result);
      } catch (cause) {
        if (version === request.current) setError(String(cause));
      } finally {
        if (version === request.current) setLoading(false);
      }
    },
    [agentId],
  );
  useEffect(() => {
    void refresh(revision > 0);
    return () => {
      request.current++;
    };
  }, [refresh, revision]);
  const models = catalog?.models ?? [];
  const matches = models.filter((model) =>
    `${model.id} ${model.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  const visibleModels = query || showAll ? matches : matches.slice(0, 12);
  return (
    <section className="agent-model-catalog" aria-label="Detected models">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-medium">Models from this agent</h3>
        <Button
          variant="ghost"
          onClick={() => void refresh(true)}
          disabled={loading || !isTauriEnvironment()}
        >
          <RefreshCw size={15} />
          Refresh models
        </Button>
      </div>
      {loading && <LoadingState label="Reading available models…" compact />}
      {error && (
        <p role="alert" className="task-error">
          {error}
        </p>
      )}
      {catalog?.detail && <p className="task-muted text-xs">{catalog.detail}</p>}
      {models.length > 0 && (
        <>
          <input
            aria-label="Find a model"
            className="task-input"
            placeholder="Find a model…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="agent-detected-models">
            {visibleModels.map((model) => (
              <Button
                key={model.id}
                variant={selected.includes(model.id) ? 'secondary' : 'outline'}
                aria-pressed={selected.includes(model.id)}
                aria-label={`${selected.includes(model.id) ? 'Remove' : 'Add'} ${model.id} ${selected.includes(model.id) ? 'from' : 'to'} model list`}
                onClick={() =>
                  onChange({
                    models: selected.includes(model.id)
                      ? selected.filter((id) => id !== model.id)
                      : [...selected, model.id],
                  })
                }
              >
                {selected.includes(model.id) ? <Check size={14} /> : <Plus size={14} />}
                <span>
                  <strong>{model.name}</strong>
                  <small>
                    {model.id}
                    {model.isDefault ? ' · CLI default' : ''}
                  </small>
                </span>
              </Button>
            ))}
          </div>
          {!query && models.length > 12 && (
            <Button variant="ghost" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer models' : `Show all ${models.length} models`}
            </Button>
          )}
          {query && matches.length === 0 && (
            <p className="task-muted">No models match this search.</p>
          )}
          <label className="task-label" htmlFor={modelSelectId}>
            Choose a default model
            <Select
              id={modelSelectId}
              aria-label="Choose a discovered default model"
              value={defaultModel || '__cli_default'}
              onValueChange={(id) =>
                onChange({
                  defaultModel: id === '__cli_default' ? '' : id,
                  ...(restricted && id !== '__cli_default' && !selected.includes(id)
                    ? { models: [...selected, id] }
                    : {}),
                })
              }
            >
              <SelectItem value="__cli_default">CLI default</SelectItem>
              {defaultModel && !models.some((model) => model.id === defaultModel) && (
                <SelectItem value={defaultModel}>{defaultModel} (manual)</SelectItem>
              )}
              {models.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </Select>
          </label>
        </>
      )}
      {!loading && !catalog && !error && (
        <p className="task-muted">Open the desktop app to discover models.</p>
      )}
    </section>
  );
}
