import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  ChoiceCards,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  FormField,
  InlineNotice,
  Input,
  Textarea,
} from '@jackalope/ui';
import { Gauge, Pencil, Scale, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DecisionOptionsView,
  ModelEvidence,
  DecisionOptions as Options,
} from '../../lib/decisions';
import { invokeNative } from '../../lib/native/transport';

const helpers = [
  [
    'agentQuestions',
    'Experiment with agent questions',
    'Let agents ask Jev batched choices, scores and yes/no questions using task evidence, selected file excerpts or captured tool results. Up to eight requests per attempt. Sends that evidence to TypeSafe; savings are unproven.',
  ],
  [
    'toolDiscovery',
    'Experiment with tool discovery',
    'Rank bounded descriptions when local search misses or returns too many tools. Sends the search and task brief to Jev; savings are unproven. Small local result sets and exact names avoid a call.',
  ],
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
  /** Evidence entries open for editing; saved ones fold to a one-line summary. */
  const [editing, setEditing] = useState<Set<string>>(new Set());
  /** Entries showing their optional limits and pricing. */
  const [extras, setExtras] = useState<Set<string>>(new Set());
  const toggle = (set: Set<string>, key: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  };
  const load = useCallback(async () => {
    const ticket = ++generation.current;
    setError('');
    setMessage('');
    setView(undefined);
    setDraft(undefined);
    setPending(false);
    try {
      const value = await invokeNative<DecisionOptionsView>('decision_options', { projectId });
      if (ticket === generation.current) {
        setView(value);
        setDraft(value.options);
        setModelKeys(value.options.models.map(() => crypto.randomUUID()));
      }
    } catch (cause) {
      if (ticket === generation.current) setError(describeError(cause));
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
      const value = await invokeNative<DecisionOptionsView>('decision_options_save', {
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
      if (ticket === generation.current) setError(describeError(cause));
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
          check output to TypeSafe. Usage includes failed calls.
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
            <div className="workspace-stack decision-goal">
              <ChoiceCards
                label="Routing goal"
                value={draft.objective}
                onValueChange={(value) => setDraft({ ...draft, objective: value })}
                options={[
                  {
                    value: 'quality',
                    title: 'Quality first',
                    description: 'Pick the strongest worker for the task.',
                    icon: <Sparkles size={18} />,
                  },
                  {
                    value: 'balanced',
                    title: 'Balanced',
                    description: 'Weigh quality against cost.',
                    icon: <Scale size={18} />,
                  },
                  {
                    value: 'economical',
                    title: 'Economical',
                    description: 'Prefer cheaper workers when they are good enough.',
                    icon: <Gauge size={18} />,
                  },
                ]}
              />
              <p className="task-muted text-sm">
                Cost comparisons need enough relevant outcome history and complete cost reports;
                otherwise Jackalope keeps quality ranking. Subscription quota is separate from API
                dollars.
              </p>
            </div>
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
                {draft.models.map((model, index) => {
                  const key = modelKeys[index];
                  const optional =
                    extras.has(key) ||
                    model.contextTokens !== null ||
                    model.efforts.length > 0 ||
                    model.inputUsdPerMillion !== null ||
                    model.outputUsdPerMillion !== null;
                  if (!editing.has(key))
                    return (
                      <div key={key} className="decision-evidence-row">
                        <span className="decision-evidence-summary">
                          <strong>{model.model || 'Unnamed model'}</strong>
                          <span className="task-muted">
                            {[model.adapter || 'No adapter', model.checkedAt.slice(0, 10)]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Edit evidence for ${model.model || `model ${index + 1}`}`}
                          onClick={() => setEditing(toggle(editing, key, true))}
                        >
                          <Pencil size={14} aria-hidden="true" />
                          Edit
                        </Button>
                      </div>
                    );
                  return (
                    <fieldset key={key} className="decision-evidence">
                      <legend>{model.model || `Model ${index + 1}`}</legend>
                      <div className="decision-evidence-grid">
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
                          description="Date and time with timezone, such as 2026-09-17T12:00:00Z."
                        >
                          <Input
                            value={model.checkedAt}
                            onChange={(e) => modelChange(index, { checkedAt: e.target.value })}
                          />
                        </FormField>
                      </div>
                      <FormField label="Capabilities and restrictions">
                        <Textarea
                          value={model.capabilities}
                          maxLength={2000}
                          onChange={(e) => modelChange(index, { capabilities: e.target.value })}
                        />
                      </FormField>
                      {optional ? (
                        <div className="decision-evidence-grid">
                          <FormField label="Context window in tokens">
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
                          <fieldset className="decision-efforts">
                            <legend>Supported effort levels</legend>
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
                          <FormField label="Input USD per million tokens">
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              value={model.inputUsdPerMillion ?? ''}
                              onChange={(e) =>
                                modelChange(index, {
                                  inputUsdPerMillion: e.target.value
                                    ? Number(e.target.value)
                                    : null,
                                })
                              }
                            />
                          </FormField>
                          <FormField label="Output USD per million tokens">
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              value={model.outputUsdPerMillion ?? ''}
                              onChange={(e) =>
                                modelChange(index, {
                                  outputUsdPerMillion: e.target.value
                                    ? Number(e.target.value)
                                    : null,
                                })
                              }
                            />
                          </FormField>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="justify-self-start"
                          onClick={() => setExtras(toggle(extras, key, true))}
                        >
                          Add context window, effort levels and pricing
                        </Button>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditing(toggle(editing, key, false))}
                        >
                          Done
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setModelKeys(modelKeys.filter((_, i) => i !== index));
                            setDraft({
                              ...draft,
                              models: draft.models.filter((_, i) => i !== index),
                            });
                          }}
                        >
                          Remove model evidence
                        </Button>
                      </div>
                    </fieldset>
                  );
                })}
                <Button
                  variant="outline"
                  disabled={draft.models.length >= 64}
                  onClick={() => {
                    const key = crypto.randomUUID();
                    setModelKeys([...modelKeys, key]);
                    setEditing(toggle(editing, key, true));
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
