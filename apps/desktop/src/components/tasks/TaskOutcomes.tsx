import { useEffect, useState } from 'react';
import { correctionPrompt, type Requirement, requirementState } from '../../lib/task-outcomes';
import { nativeTask, type TaskRun } from '../../lib/task-runtime';
import { useExecutionStore } from '../../stores/executionStore';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';
import { ScreenshotPreview } from './ScreenshotPreview';

export function TaskOutcomes({
  run,
  canReview,
  onCorrect,
  onAdvance,
}: {
  run: TaskRun;
  canReview: boolean;
  onCorrect: (prompt: string) => void;
  onAdvance: () => Promise<void>;
}) {
  const requirements = run.contract?.requirements ?? [];
  const step = run.contract?.step ?? 0;
  const steps = requirements.filter((r) => r.checkpoint);
  const finalStep = step + 1 >= steps.length;
  const [tree, setTree] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState('manual');
  const refreshTree = async () => {
    setTree(null);
    setError('');
    try {
      setTree(await nativeTask<string>('task_outcome_snapshot', { id: run.id }));
    } catch (cause) {
      setError(String(cause));
    }
  };
  useEffect(() => {
    let alive = true;
    setTree(null);
    if (canReview && requirements.length)
      void nativeTask<string>('task_outcome_snapshot', { id: run.id })
        .then((value) => {
          if (alive) {
            setTree(value);
            setError('');
          }
        })
        .catch((cause) => {
          if (alive) setError(String(cause));
        });
    return () => {
      alive = false;
    };
  }, [canReview, run.id, requirements.length]);
  if (!requirements.length) return null;
  const record = async (item: Requirement, accepted: boolean) => {
    if (!tree || busy) return;
    setBusy(true);
    setError('');
    try {
      await nativeTask('task_outcome_review', {
        review: {
          runId: run.id,
          requirementId: item.id,
          expectedTree: tree,
          accepted,
          evidence,
          note,
        },
      });
      await useExecutionStore.getState().refresh();
      setEditing(null);
      setNote('');
    } catch (cause) {
      setError(String(cause));
      setTree(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="my-6 space-y-3" aria-label="Expected outcomes and evidence">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium">Expected outcomes & evidence</h2>
        {canReview && (
          <Button variant="ghost" disabled={busy} onClick={() => void refreshTree()}>
            Refresh file snapshot
          </Button>
        )}
      </div>
      <p className="task-muted">
        Review each requirement against the result. Agent reports and screenshots need your
        judgment; acceptance applies only to the reviewed files.
      </p>
      {requirements.map((item, index) => (
        <article
          key={item.id}
          className="outcome-row py-3 border-b border-[var(--color-border)] space-y-2"
        >
          <div className="flex gap-3 items-start">
            <label className="flex h-11 w-11 shrink-0 items-center justify-center">
              <input
                type="checkbox"
                aria-label={`Request correction: ${item.title}`}
                disabled={!canReview || (item.checkpoint ? index !== step : !finalStep)}
                checked={selected.includes(item.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, item.id]
                      : selected.filter((id) => id !== item.id),
                  )
                }
              />
            </label>
            <div className="min-w-0 flex-1">
              <h3 className="font-medium break-words">
                {item.checkpoint ? `Step ${index + 1}: ` : ''}
                {item.title}
              </h3>
              <p className="task-muted">
                {item.checkpoint && index < step && item.receipt?.accepted
                  ? 'Accepted before advancing · prior step snapshot'
                  : item.checkpoint && index > step
                    ? 'Waiting for earlier step'
                    : requirementState(item, tree)}
              </p>
              {item.receipt && (
                <p className="whitespace-pre-wrap break-words mt-2">{item.receipt.note}</p>
              )}
            </div>
            {canReview && (item.checkpoint ? index === step : finalStep) && (
              <Button
                variant="outline"
                disabled={busy || !tree}
                onClick={() => {
                  setEditing(item.id);
                  setNote(item.receipt?.note ?? '');
                  setEvidence('manual');
                }}
              >
                Review evidence
              </Button>
            )}
          </div>
          {editing === item.id && (
            <div className="space-y-3 pl-7">
              <label className="block" htmlFor={`evidence-${item.id}`}>
                Evidence
                <Select id={`evidence-${item.id}`} value={evidence} onValueChange={setEvidence}>
                  <SelectItem value="manual">My inspection or interactive test</SelectItem>
                  {run.verification?.result.success && run.verification.tree === tree && (
                    <SelectItem value="verification">
                      Passed check: {run.verification.command}
                    </SelectItem>
                  )}
                  {(run.screenshots ?? []).map((s) => (
                    <SelectItem key={s.id} value={`screenshot:${s.id}`}>
                      Screenshot: {s.name}
                    </SelectItem>
                  ))}
                  {(run.validationSteps ?? []).map((s) => (
                    <SelectItem key={s.id} value={`report:${s.id}`}>
                      Agent report: {s.step} ({s.status})
                    </SelectItem>
                  ))}
                </Select>
              </label>
              {evidence.startsWith('screenshot:') &&
                run.screenshots
                  ?.filter((s) => `screenshot:${s.id}` === evidence)
                  .map((s) => (
                    <div key={s.id}>
                      <p className="task-muted">
                        Captured {new Date(s.timestamp).toLocaleString()}. Inspect whether this
                        represents the current result.
                      </p>
                      <ScreenshotPreview
                        runId={run.id}
                        screenshot={s}
                        onRetry={() => setEvidence('manual')}
                      />
                    </div>
                  ))}
              {evidence.startsWith('report:') &&
                run.validationSteps
                  ?.filter((s) => `report:${s.id}` === evidence)
                  .map((s) => (
                    <p key={s.id} className="task-muted whitespace-pre-wrap">
                      Agent-reported evidence: {s.notes} {s.evidence.join('\n')}
                    </p>
                  ))}
              {evidence === 'verification' && run.verification && (
                <pre className="task-input whitespace-pre-wrap max-h-64 overflow-auto">
                  {run.verification.result.stdout} {run.verification.result.stderr}
                </pre>
              )}
              <label className="block" htmlFor={`note-${item.id}`}>
                What did you verify, or what needs to change?
                <textarea
                  id={`note-${item.id}`}
                  rows={3}
                  className="task-input w-full"
                  maxLength={2000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !tree || !note.trim()}
                  onClick={() => void record(item, true)}
                >
                  Accept requirement
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !tree || !note.trim()}
                  onClick={() => void record(item, false)}
                >
                  Needs changes
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </article>
      ))}
      {canReview && !finalStep && (
        <div className="space-y-2">
          <p className="task-muted">
            Step {step + 1} of {steps.length}. The next step starts only when you accept this step
            and choose to advance.
          </p>
          <Button
            disabled={
              busy ||
              !tree ||
              !steps[step]?.receipt?.accepted ||
              steps[step]?.receipt?.tree !== tree
            }
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await onAdvance();
              } catch (cause) {
                setError(String(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            Continue to step {step + 2}: {steps[step + 1]?.title}
          </Button>
        </div>
      )}
      {!!selected.length && (
        <Button
          variant="outline"
          onClick={() => {
            onCorrect(correctionPrompt(requirements.filter((r) => selected.includes(r.id))));
            document.getElementById('task-reply')?.focus();
          }}
        >
          Prepare correction for {selected.length}{' '}
          {selected.length === 1 ? 'requirement' : 'requirements'}
        </Button>
      )}
      {error && (
        <p role="alert" className="task-error">
          {error}
        </p>
      )}
    </section>
  );
}
