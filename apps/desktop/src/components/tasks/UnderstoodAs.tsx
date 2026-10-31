import type { GoalRestatement } from '../../lib/task-outcomes';

/** The agent's own restatement of the task, so a misread goal shows early. */
export function UnderstoodAs({ understanding }: { understanding?: GoalRestatement | null }) {
  if (!understanding?.goal) return null;
  return (
    <section className="space-y-1 text-sm" aria-label="How the agent understood the task">
      <p className="break-words">
        <span className="font-medium">Understood as:</span> {understanding.goal}
      </p>
      <p className="task-muted break-words">
        Problem: {understanding.problem} · Smallest change: {understanding.smallestChange}
      </p>
    </section>
  );
}
