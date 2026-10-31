import { buildReviewPrompt } from '../../lib/cross-model-review';
import { reviewFingerprint } from '../../lib/review-fingerprint';
import { authorOf, rankReviewers } from '../../lib/reviewer-choice';
import type { TaskRun } from '../../lib/task-runtime';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';

/** Maps a custom agent to the adapter it runs on, for account and model-family lookups. */
export function agentAdapter(agent: string) {
  return useAgentConfigStore.getState().customAgents.find((a) => a.id === agent)?.adapter ?? agent;
}

/** Drafts a review of these changes for another available agent and returns the draft key. */
export function prepareCrossModelReview(run: TaskRun, files: string[], diff: string) {
  const key = `peer-review:${run.id}:${reviewFingerprint(diff)}`;
  const state = useExecutionStore.getState();
  const author = authorOf(run);
  if (!state.drafts[key])
    state.draft(key, {
      projectId: run.projectId,
      agent:
        rankReviewers(state.runners, author, agentAdapter).find(
          (runner) => runner.id !== author.agent,
        )?.id ?? '',
      isolated: true,
      prompt: buildReviewPrompt(run.agent, files, diff, run.workspace, run.prompt),
    });
  return key;
}
