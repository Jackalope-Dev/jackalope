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
  const Icon = icons[status];
  return (
    <span className="task-status" data-state={status}>
      <Icon size={16} aria-hidden="true" />
      {statusLabel[status]}
    </span>
  );
}
