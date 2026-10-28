import { buildReviewPrompt } from '../../lib/cross-model-review';
import { reviewFingerprint } from '../../lib/review-fingerprint';
import type { TaskRun } from '../../lib/task-runtime';
import { useExecutionStore } from '../../stores/executionStore';

/** Drafts a review of these changes for another available agent and returns the draft key. */
export function prepareCrossModelReview(run: TaskRun, files: string[], diff: string) {
  const key = `peer-review:${run.id}:${reviewFingerprint(diff)}`;
  const state = useExecutionStore.getState();
  if (!state.drafts[key])
    state.draft(key, {
      projectId: run.projectId,
      agent: state.runners.find((runner) => runner.available && runner.id !== run.agent)?.id ?? '',
      isolated: true,
      prompt: buildReviewPrompt(run.agent, files, diff, run.workspace, run.prompt),
    });
  return key;
}
