import { Badge, type BadgeProps } from '@jackalope/ui';
import { Check, CircleAlert, CircleCheck, Clock3, LoaderCircle, Square } from 'lucide-react';
import { type StepProgress, statusLabel, type TaskRun } from '../../lib/task-runtime';

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
  const variant: BadgeProps['variant'] =
    status === 'review' || status === 'reviewed'
      ? 'success'
      : status === 'failed' || status === 'interrupted'
        ? 'danger'
        : 'default';
  return (
    <Badge
      appearance="plain"
      className="task-status"
      data-state={status}
      variant={variant}
      icon={progress ? LoaderCircle : icons[status]}
    >
      {progress?.label || statusLabel[status]}
    </Badge>
  );
}
