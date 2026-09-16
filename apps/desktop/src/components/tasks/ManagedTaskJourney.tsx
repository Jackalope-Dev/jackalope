import { Check } from 'lucide-react';
import {
  type ManagedTask,
  managedTaskProgress,
  type managedTaskWork,
} from '../../lib/managed-task';
import './managed-task.css';

export function ManagedTaskJourney({
  task,
  work,
}: {
  task: ManagedTask;
  work: ReturnType<typeof managedTaskWork>;
}) {
  const progress = managedTaskProgress(task, work);
  return (
    <section className="managed-journey" aria-label="Task progress">
      <ol className="managed-journey-steps">
        {['Plan', 'Work', 'Check', 'Review'].map((label, index) => (
          <li
            key={label}
            data-complete={progress.stage > index || undefined}
            aria-current={progress.stage === index ? 'step' : undefined}
          >
            <span className="managed-step-number" aria-hidden="true">
              {progress.stage > index ? <Check size={16} /> : index + 1}
            </span>
            <span>
              {label}
              {progress.stage > index && <span className="sr-only"> completed</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className="managed-journey-description" role="status">
        {progress.description}
      </p>
    </section>
  );
}
