import {
  Button,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  FormField,
  Input,
  Select,
  SelectItem,
  Textarea,
} from '@jackalope/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DecisionOptionsView,
  ModelEvidence,
  DecisionOptions as Options,
} from '../../lib/decisions';
import { nativeTask } from '../../lib/task-runtime';
import { InlineNotice } from '../ui/InlineNotice';

const helpers = [
  [
    'contextSelection',
    'Select relevant context',
    'Rerank saved lessons and, at the app level, Ask Jackalope documentation excerpts.',
  ],
  [
    'failureTriage',
    'Explain failure categories',
    'Assess code, environment, dependency, permission and quota failures without retrying work.',
  ],
  [
    'requirementCoverage',
    'Check requirement coverage',
    'Compare saved acceptance requirements with result and check evidence. Human acceptance stays separate.',
  ],
  [
    'reviewPrioritization',
    'Prioritize review',
    'Highlight changed files that need focused review.',
  ],
  [
    'monitorFiltering',
    'Filter unrelated monitor changes',
    'Skip clearly irrelevant changes. Uncertain changes retain the monitor’s approved behavior.',
  ],
  [
    'assignmentMatching',
    'Match Automatic assignments',
    'Assess each planned worker’s own responsibility and dependencies when selecting its model.',
  ],
] as const;

export function DecisionOptions({ projectId }: { projectId?: string }) {
  const [view, setView] = useState<DecisionOptionsView>();
  const [draft, setDraft] = useState<Options>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const [modelKeys, setModelKeys] = useState<string[]>([]);
  const load = useCallback(async () => {
    const ticket = ++generation.current;
    setError('');
    setMessage('');
    setView(undefined);
    setDraft(undefined);
    setPending(false);
    try {
      const value = await nativeTask<DecisionOptionsView>('decision_options', { projectId });
      if (ticket === generation.current) {
        setView(value);
        setDraft(value.options);
        setModelKeys(value.options.models.map(() => crypto.randomUUID()));
      }
    } catch (cause) {
      if (ticket === generation.current) setError(String(cause));
    }
  }, [projectId]);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  const save = async (inherit = false) => {
    if (!view || !draft || pending) return;
    const ticket = generation.current;
    setPending(true);
    setError('');
    setMessage('');
    try {
      const value = await nativeTask<DecisionOptionsView>('decision_options_save', {
        projectId,
        revision: view.revision,
        options: inherit ? null : draft,
      });
      if (ticket !== generation.current) return;
      setView(value);
      setDraft(value.options);
      setModelKeys(value.options.models.map(() => crypto.randomUUID()));
      setMessage('Decision assistance saved.');
    } catch (cause) {
      if (ticket === generation.current) setError(String(cause));
    } finally {
      if (ticket === generation.current) setPending(false);
    }
  };
  const modelChange = (index: number, patch: Partial<ModelEvidence>) => {
    if (draft)
      setDraft({
        ...draft,
        models: draft.models.map((model, i) => (i === index ? { ...model, ...patch } : model)),
      });
  };
  return (
    <Disclosure>
      <DisclosureSummary>Routing goals and optional assistance</DisclosureSummary>
      <DisclosureBody className="workspace-stack">
        <p className="task-muted">
          These options apply while Jev is selected and connected. Optional assessments have
          separate API costs and may send repository guidance, candidate lessons, diffs, results and
          check output to TypeSafe. Usage includes failed calls. They do not approve changes or
          grant permissions.
        </p>
        {error && (
          <InlineNotice tone="error">
            {error}
            <Button variant="ghost" disabled={pending} onClick={() => void load()}>
              Reload decision options
            </Button>
          </InlineNotice>
        )}
        {!draft ? (
          <p role="status">Loading decision options…</p>
        ) : (
          <fieldset disabled={pending} className="workspace-stack">
            <legend className="sr-only">Jev decision options</legend>
            <FormField
              label="Routing goal"
              description="Cost comparisons require sufficient relevant outcome history and complete cost reports. Otherwise Jackalope retains quality ranking. Subscription quota is separate from API dollars."
            >
              <Select
                value={draft.objective}
                onValueChange={(value) =>
                  setDraft({ ...draft, objective: value as Options['objective'] })
                }
              >
                <SelectItem value="quality">Quality first</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="economical">Economical</SelectItem>
              </Select>
            </FormField>
            {helpers.map(([key, label, description]) => (
              <label key={key} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={draft[key]}
                  onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })}
                />
                <span>
                  <strong>{label}</strong>
                  <span className="task-muted block">{description}</span>
                </span>
              </label>
            ))}
            <Disclosure>
              <DisclosureSummary>Model evidence ({draft.models.length})</DisclosureSummary>
              <DisclosureBody className="workspace-stack">
                <p className="task-muted">
                  Supply current capabilities and a source for an exact model. These are your
                  supplied facts, not verified model performance. Unknown capabilities remain
                  unknown; evidence older than 90 days is marked stale.
                </p>
                {draft.models.map((model, index) => (
                  <fieldset
                    key={modelKeys[index]}
                    className="workspace-stack border rounded-lg p-3"
                  >
                    <legend>Model {index + 1}</legend>
                    <FormField label="Agent adapter">
                      <Input
                        value={model.adapter}
                        maxLength={80}
                        onChange={(e) => modelChange(index, { adapter: e.target.value })}
                        placeholder="codex, claude, opencode…"
                      />
                    </FormField>
                    <FormField label="Exact model ID">
                      <Input
                        value={model.model}
                        maxLength={160}
                        onChange={(e) => modelChange(index, { model: e.target.value })}
                      />
                    </FormField>
                    <FormField label="Capabilities and restrictions">
                      <Textarea
                        value={model.capabilities}
                        maxLength={2000}
                        onChange={(e) => modelChange(index, { capabilities: e.target.value })}
                      />
                    </FormField>
                    <FormField label="Evidence source">
                      <Input
                        value={model.source}
                        maxLength={500}
                        onChange={(e) => modelChange(index, { source: e.target.value })}
                        placeholder="Documentation URL or evaluation reference"
                      />
                    </FormField>
                    <FormField
                      label="Checked at"
                      description="Date and time with timezone, for example 2026-09-17T12:00:00Z."
                    >
                      <Input
                        value={model.checkedAt}
                        onChange={(e) => modelChange(index, { checkedAt: e.target.value })}
                      />
                    </FormField>
                    <FormField label="Context window in tokens (optional)">
                      <Input
                        type="number"
                        min={1}
                        max={10000000}
                        value={model.contextTokens ?? ''}
                        onChange={(e) =>
                          modelChange(index, {
                            contextTokens: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                      />
                    </FormField>
                    <fieldset>
                      <legend>Supported effort levels (optional)</legend>
                      <div className="flex flex-wrap gap-3">
                        {['low', 'medium', 'high', 'xhigh', 'max'].map((level) => (
                          <label key={level} className="flex gap-2 items-center">
                            <input
                              type="checkbox"
                              checked={model.efforts.includes(level)}
                              onChange={(event) =>
                                modelChange(index, {
                                  efforts: event.target.checked
                                    ? [...model.efforts, level]
                                    : model.efforts.filter((value) => value !== level),
                                })
                              }
                            />
                            {level}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <FormField label="Input USD per million tokens (optional)">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={model.inputUsdPerMillion ?? ''}
                          onChange={(e) =>
                            modelChange(index, {
                              inputUsdPerMillion: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                        />
                      </FormField>
                      <FormField label="Output USD per million tokens (optional)">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={model.outputUsdPerMillion ?? ''}
                          onChange={(e) =>
                            modelChange(index, {
                              outputUsdPerMillion: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                        />
                      </FormField>
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setModelKeys(modelKeys.filter((_, i) => i !== index));
                        setDraft({ ...draft, models: draft.models.filter((_, i) => i !== index) });
                      }}
                    >
                      Remove model evidence
                    </Button>
                  </fieldset>
                ))}
                <Button
                  variant="outline"
                  disabled={draft.models.length >= 64}
                  onClick={() => {
                    setModelKeys([...modelKeys, crypto.randomUUID()]);
                    setDraft({
                      ...draft,
                      models: [
                        ...draft.models,
                        {
                          adapter: '',
                          model: '',
                          capabilities: '',
                          source: '',
                          checkedAt: new Date().toISOString(),
                          contextTokens: null,
                          efforts: [],
                          inputUsdPerMillion: null,
                          outputUsdPerMillion: null,
                        },
                      ],
                    });
                  }}
                >
                  Add model evidence
                </Button>
              </DisclosureBody>
            </Disclosure>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void save()}
                loading={pending}
                loadingLabel="Saving…"
                disabled={JSON.stringify(draft) === JSON.stringify(view?.options)}
              >
                Save decision assistance
              </Button>
              {projectId && !view?.inherited && (
                <Button variant="ghost" onClick={() => void save(true)}>
                  Use app assistance defaults
                </Button>
              )}
            </div>
            {projectId && (
              <p className="task-muted">
                {view?.inherited
                  ? 'Inheriting app assistance defaults.'
                  : 'Using project assistance settings.'}
              </p>
            )}
          </fieldset>
        )}
        {message && <p role="status">{message}</p>}
      </DisclosureBody>
    </Disclosure>
  );
}
