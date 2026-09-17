import { Bot } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { buildReviewPrompt } from '../../lib/cross-model-review';
import { reviewFingerprint } from '../../lib/review-fingerprint';
import type { TaskRun } from '../../lib/task-runtime';
import { useExecutionStore } from '../../stores/executionStore';
import { Button } from '../ui/button';

const CaptureTask = lazy(() =>
  import('./CaptureTask').then((module) => ({ default: module.CaptureTask })),
);

export function CrossModelReviewPanel({
  run,
  files,
  diff,
}: {
  run: TaskRun;
  files: string[];
  diff: string;
}) {
  const [open, setOpen] = useState(false);
  const key = `peer-review:${run.id}:${reviewFingerprint(diff)}`;
  const prepare = () => {
    const state = useExecutionStore.getState();
    if (!state.drafts[key])
      state.draft(key, {
        projectId: run.projectId,
        agent:
          state.runners.find((runner) => runner.available && runner.id !== run.agent)?.id ?? '',
        isolated: true,
        prompt: buildReviewPrompt(run.agent, files, diff, run.workspace, run.prompt),
      });
    setOpen(true);
  };
  return (
    <>
      <Button variant="outline" size="sm" onClick={prepare}>
        <Bot size={16} /> Ask an agent to review
      </Button>
      {open && (
        <Suspense fallback={<p role="status">Preparing review request…</p>}>
          <CaptureTask
            draftKey={key}
            onClose={() => setOpen(false)}
            onStarted={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
