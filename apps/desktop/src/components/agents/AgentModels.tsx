import { Input } from '@jackalope/ui';
import { Check, Plus, RefreshCw } from 'lucide-react';
import { useId, useState } from 'react';
import { useAgentModels } from '../../lib/agent-models';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { LoadingState } from '../ui/LoadingState';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';

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
  onChange: (patch: { models?: string[]; defaultModel?: string; restrictModels?: boolean }) => void;
}) {
  const modelSelectId = useId();
  const [showAll, setShowAll] = useState(false);
  const { catalog, loading, error, refresh } = useAgentModels(agentId, revision);
  const [query, setQuery] = useState('');
  const models = catalog?.models ?? [];
  const detectedSelected = selected.filter((id) => models.some((model) => model.id === id));
  const unavailable = selected.filter((id) => !models.some((model) => model.id === id));
  const defaultAvailable = models.some((model) => model.id === defaultModel);
  const matches = models.filter((model) =>
    `${model.id} ${model.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  const visibleModels = query || showAll ? matches : matches.slice(0, 12);
  if (catalog?.source === 'local') {
    return (
      <section className="agent-model-catalog" aria-label="Local account model">
        <h3 className="text-base font-medium">{models[0]?.name}</h3>
        <p className="task-muted">{catalog.detail}</p>
        <p className="task-muted text-xs">
          This account has its own model. Other OpenCode accounts keep their saved model
          preferences. Use local setup to check and connect another local model.
        </p>
        {restricted && !detectedSelected.length && (
          <InlineNotice tone="error">
            This model is excluded by your model restriction. Add it to allow tasks.
          </InlineNotice>
        )}
        {!detectedSelected.length && models[0] && (
          <Button
            variant="outline"
            onClick={() => onChange({ models: [...selected, models[0].id] })}
          >
            <Plus size={15} /> Allow this model
          </Button>
        )}
      </section>
    );
  }
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
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {catalog?.detail && <p className="task-muted text-xs">{catalog.detail}</p>}
      {!loading && !models.length && (
        <p className="task-muted">
          Available models could not be detected. Model selection is unavailable.
        </p>
      )}
      {(models.length > 0 || restricted) && (
        <div className="agent-model-restriction">
          <span>Use only selected models</span>
          <Switch
            checked={restricted}
            disabled={loading}
            label="Use only selected models"
            onCheckedChange={(value) =>
              onChange({
                restrictModels: value,
                ...(value
                  ? {
                      models: [
                        ...new Set([
                          ...(detectedSelected.length
                            ? detectedSelected
                            : models.map((model) => model.id)),
                          ...(defaultAvailable ? [defaultModel] : []),
                        ]),
                      ],
                      ...(!defaultAvailable ? { defaultModel: '' } : {}),
                    }
                  : {}),
              })
            }
          />
        </div>
      )}
      {restricted && !loading && !detectedSelected.length && (
        <InlineNotice tone="error">
          No selected models could be verified. Refresh models, choose available models or turn off
          the restriction.
        </InlineNotice>
      )}
      {!loading && (unavailable.length > 0 || (defaultModel && !defaultAvailable)) && (
        <div className="task-notice">
          <p>
            Some saved model choices could not be verified:{' '}
            {[
              ...new Set([
                ...unavailable,
                ...(!defaultAvailable && defaultModel ? [defaultModel] : []),
              ]),
            ].join(', ')}
            . They remain saved but are not offered as available choices.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange({ models: [], defaultModel: '', restrictModels: false })}
          >
            Reset model preferences
          </Button>
        </div>
      )}
      {models.length > 0 && (
        <>
          <Input
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
                disabled={
                  restricted && detectedSelected.length === 1 && detectedSelected.includes(model.id)
                }
                aria-label={`${selected.includes(model.id) ? 'Remove' : 'Add'} ${model.id} ${selected.includes(model.id) ? 'from' : 'to'} model list`}
                onClick={() =>
                  onChange({
                    models: selected.includes(model.id)
                      ? selected.filter((id) => id !== model.id)
                      : [...selected, model.id],
                    ...(restricted && selected.includes(model.id) && defaultModel === model.id
                      ? { defaultModel: '' }
                      : {}),
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
              value={
                defaultModel ? (defaultAvailable ? defaultModel : '__unavailable') : '__cli_default'
              }
              onValueChange={(id) =>
                onChange({
                  defaultModel: id === '__cli_default' ? '' : id,
                  ...(restricted && id !== '__cli_default' && !selected.includes(id)
                    ? { models: [...selected, id] }
                    : {}),
                })
              }
            >
              <SelectItem value="__cli_default">
                {restricted ? 'First selected model' : 'Let the agent choose'}
              </SelectItem>
              {defaultModel && !defaultAvailable && (
                <SelectItem value="__unavailable" disabled>
                  Saved model unavailable
                </SelectItem>
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
