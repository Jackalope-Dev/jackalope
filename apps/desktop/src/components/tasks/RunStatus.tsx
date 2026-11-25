import { isActive, isDone, needsAttention, statusLabel } from '@jackalope/contracts/runs';
import { Badge, type BadgeProps, ThinkingOrb } from '@jackalope/ui';
import { Check, CircleAlert, CircleCheck, Clock3, LoaderCircle, Square } from 'lucide-react';
import type { StepProgress, TaskRun } from '../../lib/run-types';
import { activityOrb } from '../../lib/task-live-activity';

const icons = {
  starting: Clock3,
  running: LoaderCircle,
  stopping: Square,
  stopped: Square,
  interrupted: CircleAlert,
  failed: CircleAlert,
  review: CircleCheck,
  reviewed: Check,
};

export function RunStatus({
  status,
  progress,
}: {
  status: TaskRun['status'];
  /** Names the step actually running, which is more use than the broad status it belongs to. */
  progress?: StepProgress | null;
}) {
  const variant: BadgeProps['variant'] = isDone(status)
    ? 'success'
    : needsAttention(status)
      ? 'danger'
      : 'default';
  const active = isActive(status);
  return (
    <Badge
      appearance="plain"
      className="task-status"
      data-state={status}
      variant={variant}
      icon={active && status !== 'stopping' ? undefined : icons[status]}
    >
      {active && status !== 'stopping' && (
        <ThinkingOrb state={activityOrb(status, progress)} size={20} aria-hidden="true" />
      )}
      {progress?.label || statusLabel[status]}
    </Badge>
  );
}
