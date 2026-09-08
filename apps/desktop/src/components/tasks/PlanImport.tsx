import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { builtinAgents } from '../../lib/agent-catalog';
import { queueCommand } from '../../lib/queue';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import type { Project } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { useDialogFocus } from '../ui/useDialogFocus';

interface PlanEntry {
  contextSelection?: import('../../lib/knowledge').ContextSelection;
  key: string;
  title: string;
  prompt: string;
  agent: string;
  scopes: string[];
  dependsOn: string[];
}
interface Props {
  project: Project;
  onAdded: () => Promise<void>;
  onClose: () => void;
  enabled: boolean;
}

const example = JSON.stringify(
  [
    {
      key: 'settings',
      title: 'Build project settings',
      prompt:
        'Implement the agreed project settings experience. Verify the changed behavior and summarize the result for review.',
      agent: 'codex',
      scopes: ['src/settings'],
      dependsOn: [],
    },
    {
      key: 'settings-guide',
      title: 'Document project settings',
      prompt:
        'Document the completed project settings workflow with examples based on the actual implementation.',
      agent: 'claude',
      scopes: ['docs'],
      dependsOn: ['settings'],
    },
  ],
  null,
  2,
);

function parsePlan(text: string): PlanEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(
      'This is not valid JSON. Paste the array from your agent’s plan, without a Markdown code fence.',
    );
  }
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) {
    throw new Error('A plan needs an array of 1–100 tasks.');
  }
  const entries: PlanEntry[] = [];
  const known = new Map<string, PlanEntry>();
  for (const [index, value] of raw.entries()) {
    const label = `Task ${index + 1}`;
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new Error(`${label} must be an object.`);
    const item = value as Record<string, unknown>;
    if (typeof item.key !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.key))
      throw new Error(`${label} needs a key of 1–80 letters, numbers, underscores or hyphens.`);
    if (known.has(item.key))
      throw new Error(`The key “${item.key}” appears twice. Every task needs its own key.`);
    if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 160)
      throw new Error(`${label} needs a title of 1–160 characters.`);
    if (typeof item.prompt !== 'string' || !item.prompt.trim() || item.prompt.length > 20_000)
      throw new Error(`${label} needs instructions of 1–20,000 characters.`);
    if (
      ![
        ...builtinAgents.map((agent) => agent.id),
        ...useAgentConfigStore.getState().customAgents.map((a) => a.id),
      ].includes(String(item.agent))
    )
      throw new Error(
        `${label} must choose an available agent (${builtinAgents.map((agent) => agent.id).join(', ')} or a configured custom agent).`,
      );
    if (
      !Array.isArray(item.scopes) ||
      item.scopes.length < 1 ||
      item.scopes.length > 30 ||
      item.scopes.some(
        (scope) =>
          typeof scope !== 'string' ||
          !scope.trim() ||
          scope.length > 240 ||
          /^[/\\]|^[A-Za-z]:/.test(scope.trim()) ||
          scope.trim().replaceAll('\\', '/').split('/').includes('..') ||
          (scope.trim() !== '.' && scope.trim().replaceAll('\\', '/').split('/').includes('.')),
      )
    ) {
      throw new Error(
        `${label} needs 1–30 project-relative scopes, without absolute paths or embedded “.” or “..” segments. Use “.” alone for the whole project.`,
      );
    }
    if (!Array.isArray(item.dependsOn) || item.dependsOn.some((key) => typeof key !== 'string'))
      throw new Error(`${label} needs a dependsOn array of task keys (or [] for no dependencies).`);
    const entry: PlanEntry = {
      contextSelection: item.contextSelection as PlanEntry['contextSelection'],
      key: item.key,
      title: item.title.trim(),
      prompt: item.prompt.trim(),
      agent: item.agent as PlanEntry['agent'],
      scopes: [...new Set((item.scopes as string[]).map((scope) => scope.trim()))],
      dependsOn: [...new Set(item.dependsOn as string[])],
    };
    known.set(entry.key, entry);
    entries.push(entry);
  }
  const ordered: PlanEntry[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (entry: PlanEntry) => {
    if (visited.has(entry.key)) return;
    if (visiting.has(entry.key))
      throw new Error(
        `The dependencies loop back to “${entry.key}”. Remove the circular dependency before importing.`,
      );
    visiting.add(entry.key);
    for (const key of entry.dependsOn) {
      const dependency = known.get(key);
      if (!dependency)
        throw new Error(`“${entry.key}” depends on “${key}”, which is missing from this plan.`);
      visit(dependency);
    }
    visiting.delete(entry.key);
    visited.add(entry.key);
    ordered.push(entry);
  };
  entries.forEach(visit);
  return ordered;
}

function PlanImportDialog({ project, onAdded, onClose, enabled }: Props) {
  const dialogFocus = useDialogFocus();
  const storageKey = `jackalope-plan-import-draft:${project.id}`;
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(storageKey) ?? '';
    } catch {
      return '';
    }
  });
  const [preview, setPreview] = useState<PlanEntry[] | null>(null);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const submitting = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const edit = (value: string) => {
    setText(value);
    setPreview(null);
    setError('');
    try {
      localStorage.setItem(storageKey, value);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  };
  const review = () => {
    setError('');
    try {
      setPreview(parsePlan(text));
    } catch (cause) {
      setPreview(null);
      setError(String(cause));
    }
  };
  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 256_000) {
      setError('This plan is too large. Choose a JSON file smaller than 256 KB.');
      return;
    }
    try {
      edit((await file.text()).replace(/^\uFEFF/, ''));
    } catch {
      setError('The plan file could not be read. Try choosing it again, or paste its contents.');
    }
  };
  const add = async () => {
    if (!preview || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      if (!added) {
        await queueCommand('queue_import', {
          request: {
            projectId: project.id,
            projectName: project.name,
            projectPath: project.path,
            targetBranch: project.preferences?.baseBranch || project.gitBranch,
            verifyCommand: project.preferences?.verifyCommand,
            prepareCommand: project.preferences?.prepareCommand,
            autoVerify: project.preferences?.autoVerify === true,
            agentAccounts: project.preferences?.agentAccounts,
            items: preview,
          },
        });
        setAdded(true);
        try {
          localStorage.removeItem(storageKey);
        } catch {
          setStorageError(true);
        }
      }
      await onAdded();
      onClose();
    } catch (cause) {
      setError(String(cause));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content
          {...dialogFocus}
          className="task-dialog appearance-panel"
          style={{
            width: 'min(720px, calc(100vw - 40px))',
            maxHeight: 'calc(100vh - 48px)',
            overflowY: 'auto',
          }}
        >
          <Dialog.Close className="task-close" aria-label="Close plan import" disabled={busy}>
            <X size={18} />
          </Dialog.Close>
          <Dialog.Title className="text-2xl font-medium tracking-tight">
            Bring a plan to {project.name}.
          </Dialog.Title>
          <Dialog.Description className="task-muted mt-3 mb-5">
            Load a plan from your agent or project docs, or paste an export. Check the assignments,
            then add the tasks together.
          </Dialog.Description>
          {!preview ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="plan-export" className="task-label">
                  Plan export · JSON
                </label>
                <Button variant="outline" onClick={() => fileInput.current?.click()}>
                  Load plan file
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  aria-label="Choose a JSON plan file"
                  onChange={(event) => {
                    void loadFile(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
              </div>
              <textarea
                id="plan-export"
                className="task-input w-full mt-2 font-mono text-xs"
                style={{ minHeight: 180, resize: 'vertical' }}
                maxLength={256_000}
                value={text}
                onChange={(event) => edit(event.target.value)}
                spellCheck={false}
                aria-describedby="plan-format"
              />
              <p id="plan-format" className="task-muted text-xs mt-2">
                Each task names an agent, file or folder scopes, and any tasks it depends on. Keep
                the instructions concrete enough to review the result.
              </p>
              <details className="mt-4 text-sm">
                <summary className="task-link cursor-pointer">Show the export format</summary>
                <pre className="task-muted text-xs mt-3 overflow-x-auto whitespace-pre-wrap break-words">
                  {example}
                </pre>
              </details>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-4 mb-3">
                <p className="font-medium">
                  {preview.length} tasks · {new Set(preview.map((item) => item.agent)).size} agents
                </p>
                {!added && (
                  <Button variant="ghost" disabled={busy} onClick={() => setPreview(null)}>
                    Edit plan
                  </Button>
                )}
              </div>
              <ol className="space-y-4">
                {preview.map((item, index) => (
                  <li key={item.key} className="border-t border-[var(--color-border)] pt-4">
                    <p className="text-sm font-medium">
                      {index + 1}. {item.title}
                    </p>
                    <p className="task-muted text-xs mt-1 break-words">
                      {item.agent === 'claude'
                        ? 'Claude Code'
                        : item.agent === 'codex'
                          ? 'Codex'
                          : 'Grok'}{' '}
                      · {item.scopes.join(', ')}
                    </p>
                    <p className="task-muted text-xs mt-1">
                      {item.dependsOn.length
                        ? `After: ${item.dependsOn.map((key) => preview.find((task) => task.key === key)?.title ?? key).join(', ')}`
                        : 'No dependencies'}
                    </p>
                    <details className="mt-2 text-xs">
                      <summary className="task-link cursor-pointer">Read instructions</summary>
                      <p className="task-muted mt-2 whitespace-pre-wrap break-words">
                        {item.prompt}
                      </p>
                    </details>
                  </li>
                ))}
              </ol>
              {enabled && !added && (
                <p className="task-notice mt-5">
                  Adding this plan pauses project dispatch so you can review the tasks before
                  starting.
                </p>
              )}
              {!enabled && !added && (
                <p className="task-muted text-xs mt-5">
                  The tasks will wait in your queue until you start parallel work.
                </p>
              )}
              {added && (
                <p role="status" className="task-notice mt-5">
                  Your tasks were added. Refresh the queue to see them; this will not import them
                  again.
                </p>
              )}
            </>
          )}
          {storageError && (
            <p className="task-muted text-xs mt-3">
              This device could not save the draft. Keep a copy before closing.
            </p>
          )}
          {error && (
            <p role="alert" className="task-error mt-4">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3 mt-6">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              {added ? 'Close' : 'Cancel'}
            </Button>
            <Button disabled={busy || !text.trim()} onClick={preview ? () => void add() : review}>
              {busy
                ? 'Adding…'
                : added
                  ? 'Refresh queue'
                  : preview
                    ? `Add ${preview.length} tasks`
                    : 'Review plan'}
              <ArrowRight size={14} />
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function PlanImport(props: Props) {
  return <PlanImportDialog key={props.project.id} {...props} />;
}
