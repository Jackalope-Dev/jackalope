import { latestTaskRuns, recordedOutcome } from './agent-analytics.ts';
import type { TaskRun } from './task-runtime.ts';

export interface WorkflowInsight {
  id: string;
  category: 'review' | 'checks' | 'learning' | 'resilience';
  title: string;
  description: string;
  runs: TaskRun[];
}

export function generateAgentInsights(runs: TaskRun[]): WorkflowInsight[] {
  const latest = latestTaskRuns(runs);
  const insights: WorkflowInsight[] = [];
  const changes = latest.filter((run) => recordedOutcome(run) === 'changes');
  if (changes.length)
    insights.push({
      id: 'review-changes',
      category: 'review',
      title: 'Review feedback to address',
      description: `${changes.length} task(s) have a recorded request for changes on their latest saved attempt. Open the outcome feedback before continuing.`,
      runs: changes,
    });
  const failed = latest.filter((run) => run.verification && !run.verification.result.success);
  if (failed.length)
    insights.push({
      id: 'failed-checks',
      category: 'checks',
      title: 'Saved checks need attention',
      description: `${failed.length} task(s) have an unsuccessful saved verification result. Inspect the command and output, correct the cause, then rerun the check.`,
      runs: failed,
    });
  const handoffs = latest.filter((run) => run.routing?.handoffs.length);
  if (handoffs.length)
    insights.push({
      id: 'quota-handoffs',
      category: 'resilience',
      title: 'Tasks reached provider quota',
      description: `${handoffs.length} task(s) recorded quota handoffs; ${handoffs.filter((run) => ['review', 'reviewed'].includes(run.status)).length} subsequently finished. Inspect routing history and account capacity if interruptions recur.`,
      runs: handoffs,
    });
  const groups = [true, false].map((withContext) => {
    const group = latest.filter(
      (run) => Boolean(run.contextReceipt?.entries.length) === withContext && recordedOutcome(run),
    );
    return {
      runs: group,
      accepted: group.filter((run) => recordedOutcome(run) === 'accepted').length,
    };
  });
  if (groups.every((group) => group.runs.length >= 3))
    insights.push({
      id: 'context-outcomes',
      category: 'learning',
      title: 'Recorded outcomes with project context',
      description: `With saved context: ${groups[0].accepted}/${groups[0].runs.length} accepted. Without: ${groups[1].accepted}/${groups[1].runs.length} accepted. These are different tasks, not a controlled comparison; they do not establish that context improved quality. Inspect the supplied lessons and feedback.`,
      runs: groups.flatMap((group) => group.runs),
    });
  return insights;
}
