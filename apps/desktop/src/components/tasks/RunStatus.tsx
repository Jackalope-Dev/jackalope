import { Badge, type BadgeProps } from '@jackalope/ui';
import { Check, CircleAlert, CircleCheck, Clock3, LoaderCircle, Square } from 'lucide-react';
import { statusLabel, type TaskRun } from '../../lib/task-runtime';

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

export function RunStatus({ status }: { status: TaskRun['status'] }) {
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
      icon={icons[status]}
    >
      {statusLabel[status]}
    </Badge>
  );
}
