import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  ConfirmDialog,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  Icon,
  InlineNotice,
  LoadingState,
  Tooltip,
} from '@jackalope/ui';
import { PencilLine } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import {
  describeRewind,
  pendingRewind,
  type RewindOutcome,
  type RewindPreview,
  rewindOption,
  taskTurns,
} from '../../lib/rewind';
import type { TaskRun } from '../../lib/run-types';
import { previewRewind, rewindTo, undoRewind } from '../../lib/task-client';
import './edit-from-here.css';

/**
 * "Edit from here" on one turn of a conversation or task: shown on hover or keyboard focus
 * with the turn's other actions, only for agents that can return their conversation to an
 * earlier turn. A turn that cannot be rewound says why instead of acting.
 */
export function EditFromHereButton({
  runs,
  run,
  className = 'live-copy',
  onRewound,
}: {
  runs: readonly TaskRun[];
  run: TaskRun;
  className?: string;
  /** Receives the turn's prompt for the composer once the rewind is done. */
  onRewound: (outcome: RewindOutcome) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const option = rewindOption(runs, run);
  if (option.state === 'hidden') return null;
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={`edit-from-here ${className}`}
      aria-disabled={option.state === 'disabled' || undefined}
      aria-haspopup="dialog"
      onClick={() => {
        if (option.state === 'available') setOpen(true);
      }}
    >
      <Icon icon={PencilLine} />
      <span>Edit from here</span>
    </Button>
  );
  return (
    <>
      {option.state === 'disabled' ? <Tooltip content={option.reason}>{button}</Tooltip> : button}
      {open && <RewindDialog runId={run.id} onOpenChange={setOpen} onRewound={onRewound} />}
    </>
  );
}

function RewindDialog({
  runId,
  onOpenChange,
  onRewound,
}: {
  runId: string;
  onOpenChange: (open: boolean) => void;
  onRewound: (outcome: RewindOutcome) => void | Promise<void>;
}) {
  const [preview, setPreview] = useState<RewindPreview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    previewRewind(runId)
      .then((value) => alive && setPreview(value))
      .catch((cause) => alive && setError(describeError(cause)));
    return () => {
      alive = false;
    };
  }, [runId]);
  const text = preview && describeRewind(preview);
  return (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title={preview ? `Edit from turn ${preview.turn}?` : 'Edit from here?'}
      description={text?.summary ?? 'Checking what a rewind to this turn would change.'}
      label="Rewind"
      busyLabel="Rewinding…"
      variant="primary"
      disabled={!preview}
      onConfirm={async () => {
        if (!preview) return;
        const outcome = await rewindTo(preview.runId, preview.latestRunId).catch((cause) => {
          throw new Error(describeError(cause));
        });
        await onRewound(outcome);
      }}
    >
      {error ? (
        <InlineNotice tone="error">{error}</InlineNotice>
      ) : text ? (
        <div className="rewind-details">
          <p>{text.conversation}</p>
          <p>{text.prompt}</p>
          <p>{text.undo}</p>
        </div>
      ) : (
        <LoadingState label="Checking the turn…" />
      )}
    </ConfirmDialog>
  );
}

/**
 * The rewind the latest turn still holds, with Undo. Undo restores the files saved before
 * the rewind and lets the next turn continue the original conversation.
 */
export function RewindUndoNotice({
  runs,
  taskId,
  onChanged,
  className,
}: {
  runs: readonly TaskRun[];
  taskId: string;
  onChanged: () => void | Promise<void>;
  /** Wraps the notice, only while there is one to show. */
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rewind = pendingRewind(runs, taskId);
  const latest = taskTurns(runs, taskId).at(-1);
  if (!rewind || !latest) return null;
  const undone = rewind.rewoundRunIds.length;
  return (
    <div className={className}>
      <InlineNotice
        className="rewind-notice"
        action={
          <Button
            variant="outline"
            loading={busy}
            loadingLabel="Undoing…"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await undoRewind(latest.id);
                await onChanged();
              } catch (cause) {
                setError(describeError(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            Undo rewind
          </Button>
        }
      >
        Rewound to turn {rewind.turn}: {undone} {undone === 1 ? 'turn is' : 'turns are'} undone and
        files are back to how that turn found them. Your files from before are saved in Git at{' '}
        <code>{rewind.safety.reference}</code>. Undo is available until you send the next message.
        {error && <span className="rewind-error"> {error}</span>}
      </InlineNotice>
    </div>
  );
}

/** Turns a rewind undid: collapsed and muted, still readable, never removed. */
export function RewoundTurns({ count, children }: { count: number; children: ReactNode }) {
  return (
    <Disclosure className="rewound-turns">
      <DisclosureSummary>
        {count} rewound {count === 1 ? 'turn' : 'turns'}
      </DisclosureSummary>
      <DisclosureBody className="rewound-turns-body">{children}</DisclosureBody>
    </Disclosure>
  );
}
