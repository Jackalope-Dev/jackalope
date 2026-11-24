import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  Checkbox,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  FieldCheck,
  FormField,
  Input,
  Select,
  SelectItem,
  Textarea,
  useDialogFocus,
} from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import type { KnowledgeEntry, ToolRule } from '../../lib/knowledge-types';
import { invokeNative } from '../../lib/native/transport';
import { OutcomeEditor } from '../tasks/OutcomeEditor';
import { ActionError } from '../ui/ActionError';
import './knowledge-editor.css';

export function KnowledgeEditor({
  entry,
  onClose,
  onSaved,
}: {
  entry: KnowledgeEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(entry);
  const [phrases, setPhrases] = useState(entry.keywords.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const focus = useDialogFocus();
  const memory = value.kind === 'memory';
  const limit = memory ? 800 : 6000;
  const bytes = new TextEncoder().encode(value.content).length;
  const keywords = phrases
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const process = value.process ?? { inputs: [], steps: [], outcomes: [] };
  const rule = value.toolRule;
  const setRule = (change: Partial<ToolRule>) =>
    rule && setValue({ ...value, toolRule: { ...rule, ...change } });
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent {...focus} className={memory ? 'knowledge-editor' : 'knowledge-editor wide'}>
        <DialogCloseButton disabled={busy} label="Close editor" />
        <DialogHeader
          title={memory ? 'Save a project lesson' : 'Save a reusable workflow'}
          description={`${
            memory
              ? 'Keep one useful fact or decision. Matching future tasks can use it with any agent.'
              : 'Describe the repeatable procedure, required tools, and checks. Apply it to a new task when needed.'
          } Saved locally; no model call is made.`}
        />
        <form
          className="knowledge-editor-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError('');
            try {
              await invokeNative('knowledge_save', { entry: { ...value, keywords } });
              onSaved();
            } catch (cause) {
              setError(describeError(cause));
            } finally {
              setBusy(false);
            }
          }}
        >
          <FormField label="Title">
            <Input
              id="knowledge-title"
              required
              maxLength={120}
              value={value.title}
              onChange={(e) => setValue({ ...value, title: e.target.value })}
            />
          </FormField>
          <div className="knowledge-editor-content">
            <FormField label={memory ? 'Lesson' : 'Procedure'}>
              <Textarea
                id="knowledge-content"
                required
                aria-describedby="knowledge-content-size"
                rows={memory ? 4 : 6}
                maxLength={limit}
                value={value.content}
                onChange={(e) => setValue({ ...value, content: e.target.value })}
              />
            </FormField>
            <FieldCheck id="knowledge-content-size" tone={bytes > limit ? 'error' : 'info'}>
              {bytes.toLocaleString()} of {limit.toLocaleString()} bytes.{' '}
              {memory
                ? 'Keep it concise; at most three matching lessons are included per task.'
                : 'Only included when you select this workflow.'}
            </FieldCheck>
          </div>
          {!memory && (
            <section className="knowledge-process" aria-label="Workflow process">
              <ol className="knowledge-process-flow" aria-label="How the workflow runs">
                <li>
                  <strong>{process.inputs.length}</strong> inputs
                </li>
                <ArrowRight size={14} aria-hidden="true" />
                <li>
                  <strong>{process.steps.length}</strong> steps, each reviewed
                </li>
                <ArrowRight size={14} aria-hidden="true" />
                <li>
                  <strong>{process.outcomes.length}</strong> outcomes
                </li>
              </ol>
              <div className="knowledge-process-lists">
                <OutcomeEditor
                  label="Required inputs"
                  values={value.process?.inputs ?? []}
                  onChange={(inputs) =>
                    setValue({
                      ...value,
                      process: { outcomes: [], steps: [], ...value.process, inputs },
                    })
                  }
                />
                <OutcomeEditor
                  label="Process steps, with approval before advancing"
                  values={value.process?.steps ?? []}
                  onChange={(steps) =>
                    setValue({
                      ...value,
                      process: { outcomes: [], inputs: [], ...value.process, steps },
                    })
                  }
                />
                <OutcomeEditor
                  label="Expected outcomes"
                  values={value.process?.outcomes ?? []}
                  onChange={(outcomes) =>
                    setValue({
                      ...value,
                      process: { inputs: [], steps: [], ...value.process, outcomes },
                    })
                  }
                />
              </div>
              <p className="task-muted">
                Inputs are required before launch. Each step runs separately and pauses for your
                evidence review before the next step. Final outcomes require review before
                completion or integration.
              </p>
            </section>
          )}
          {memory && (
            <div className="knowledge-editor-content">
              <FormField
                label="Use when a task mentions"
                description="Comma-separated words or phrases. Matches ignore case and punctuation."
              >
                <Input
                  id="knowledge-phrases"
                  required
                  value={phrases}
                  onChange={(e) => setPhrases(e.target.value)}
                  placeholder="release, installer, Windows upgrade"
                />
              </FormField>
              {keywords.length > 0 && (
                <ul className="knowledge-phrases" aria-label="Matching phrases">
                  {keywords.map((keyword) => (
                    <li key={keyword}>{keyword}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {memory && (
            <fieldset className="knowledge-rule">
              <legend className="ui-sr-only">Tool rule</legend>
              <label className="knowledge-editor-enabled">
                <Checkbox
                  checked={!!rule}
                  onChange={(e) =>
                    setValue({ ...value, toolRule: e.target.checked ? newToolRule(value) : null })
                  }
                />
                Check agents' tool calls against this lesson
              </label>
              {rule && (
                <>
                  <fieldset className="knowledge-rule-tools">
                    <legend>Applies to</legend>
                    {TOOL_KINDS.map(([kind, label]) => (
                      <label key={kind}>
                        <Checkbox
                          checked={rule.tools.includes(kind)}
                          onChange={(e) =>
                            setRule({
                              tools: e.target.checked
                                ? [...rule.tools, kind]
                                : rule.tools.filter((tool) => tool !== kind),
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                  <FormField
                    label="Command or text pattern"
                    description="A regular expression searched in the command or the text written. Start with (?i) to ignore case."
                  >
                    <Input
                      id="knowledge-rule-pattern"
                      className="font-mono"
                      maxLength={500}
                      spellCheck={false}
                      value={rule.pattern ?? ''}
                      onChange={(e) => setRule({ pattern: e.target.value })}
                      placeholder="\bnpm\s+install\b"
                    />
                  </FormField>
                  <FormField
                    label="Files"
                    description="A glob in the workspace, such as src/**/*.ts. Without a slash it matches the file name in any folder. Shell commands have no file, so a rule with files checks only writes and edits."
                  >
                    <Input
                      id="knowledge-rule-path"
                      className="font-mono"
                      maxLength={240}
                      spellCheck={false}
                      value={rule.path ?? ''}
                      onChange={(e) => setRule({ path: e.target.value })}
                      placeholder="*.lock"
                    />
                  </FormField>
                  <FormField label="When it matches">
                    <Select
                      id="knowledge-rule-action"
                      value={rule.action}
                      onValueChange={(action) => setRule({ action: action as ToolRule['action'] })}
                    >
                      <SelectItem value="warn">Let it run and warn the agent</SelectItem>
                      <SelectItem value="deny">Block it and tell the agent why</SelectItem>
                    </Select>
                  </FormField>
                  <FormField label="Message to the agent">
                    <Textarea
                      id="knowledge-rule-message"
                      required
                      rows={2}
                      maxLength={800}
                      value={rule.message}
                      onChange={(e) => setRule({ message: e.target.value })}
                    />
                  </FormField>
                  <p className="task-muted">
                    Checked on Claude Code shell commands, writes and edits, and on permission
                    requests from OpenCode and ACP agents. Every match is recorded in the task's
                    activity.
                  </p>
                </>
              )}
            </fieldset>
          )}
          <label className="knowledge-editor-enabled">
            <Checkbox
              checked={value.enabled}
              onChange={(e) => setValue({ ...value, enabled: e.target.checked })}
            />
            Available for future tasks
          </label>
          <ActionError error={error} />
          <Button
            type="submit"
            disabled={busy || bytes > limit}
            loading={busy}
            loadingLabel="Saving…"
          >
            {memory ? 'Save lesson' : 'Save workflow'}
          </Button>
        </form>
      </DialogContent>
    </Dialog.Root>
  );
}

const TOOL_KINDS: [ToolRule['tools'][number], string][] = [
  ['shell', 'Shell commands'],
  ['write', 'File writes'],
  ['edit', 'File edits'],
];

/** A starting rule for a lesson, with the lesson as the message. */
export function newToolRule(entry: KnowledgeEntry): ToolRule {
  return {
    tools: ['shell'],
    pattern: '',
    path: '',
    action: 'warn',
    message: entry.content.slice(0, 800),
  };
}

/** What a rule does, such as "blocks shell commands and file writes". */
export function toolRuleSummary(rule: ToolRule): string {
  const kinds = TOOL_KINDS.filter(([kind]) => rule.tools.includes(kind)).map(([, label]) =>
    label.toLowerCase(),
  );
  const list =
    kinds.length > 1 ? `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]}` : kinds[0];
  return `${rule.action === 'deny' ? 'blocks' : 'warns on'} ${list ?? 'tool calls'}`;
}

export function newKnowledge(
  project: { id: string; path: string },
  kind: KnowledgeEntry['kind'],
  sourceRunId: string | null = null,
): KnowledgeEntry {
  return {
    id: crypto.randomUUID(),
    projectId: project.id,
    projectPath: project.path,
    kind,
    title: '',
    content: '',
    keywords: [],
    enabled: true,
    sourceRunId,
    revision: 0,
    updatedAt: '',
  };
}
