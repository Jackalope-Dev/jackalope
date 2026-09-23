import { FormField, Textarea } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { nativeTask, type TaskRun } from '../../lib/task-runtime';
import { useExecutionStore } from '../../stores/executionStore';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogFooter, DialogHeader } from '../ui/Dialog';
import { InlineNotice } from '../ui/InlineNotice';

export function ApproveWork({ run, onApproved }: { run: TaskRun; onApproved: () => void }) {
  const [open, setOpen] = useState(false);
  const [tree, setTree] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requirements = run.contract?.requirements ?? [];
  const step = run.contract?.step ?? 0;
  const currentRequirements = requirements.filter(
    (item, index) => !item.checkpoint || index === step,
  );
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setTree(null);
    setError('');
    void nativeTask<string>('task_outcome_snapshot', { id: run.id }).then(
      (value) => {
        if (alive) setTree(value);
      },
      (cause) => {
        if (alive) setError(String(cause));
      },
    );
    return () => {
      alive = false;
    };
  }, [open, run.id]);
  const approve = async () => {
    if (busy || !tree) return;
    setBusy(true);
    setError('');
    try {
      for (const item of currentRequirements) {
        if (item.receipt?.accepted && item.receipt.tree === tree) continue;
        await nativeTask('task_outcome_review', {
          review: {
            runId: run.id,
            requirementId: item.id,
            expectedTree: tree,
            accepted: true,
            evidence: 'manual',
            note,
          },
        });
      }
      await nativeTask('task_mark_reviewed', { id: run.id });
      await useExecutionStore.getState().refresh();
      setOpen(false);
      onApproved();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const needsEvidence = currentRequirements.some(
    (item) => !item.receipt?.accepted || item.receipt.tree !== tree,
  );
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <Dialog.Trigger asChild>
        <Button>
          <Check size={16} /> Approve work
        </Button>
      </Dialog.Trigger>
      <DialogContent
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogCloseButton disabled={busy} />
        <DialogHeader
          title="Approve work"
          description="Confirm that the result meets your expectations. Merging is a separate step."
        />
        {currentRequirements.length > 0 && (
          <div className="space-y-4">
            <p>You’re approving these outcomes:</p>
            <ul className="list-disc pl-5 space-y-2">
              {currentRequirements.map((item) => (
                <li key={item.id}>{item.title}</li>
              ))}
            </ul>
            {needsEvidence && (
              <FormField label="What did you verify?">
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={2000}
                  rows={3}
                  disabled={busy}
                />
              </FormField>
            )}
          </div>
        )}
        {!tree && !error && <p role="status">Checking the current files…</p>}
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || !tree || (needsEvidence && !note.trim())}
            loading={busy}
            loadingLabel="Approving…"
            onClick={() => void approve()}
          >
            Approve work
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}
