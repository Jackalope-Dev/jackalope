import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import { ArrowRight, Check, FileDiff, GitMerge, ListChecks, RefreshCw } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { reviewFingerprint } from '../../lib/review-fingerprint';
import { nativeTask, type Review, type TaskRun } from '../../lib/task-runtime';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { WorkspaceTabs as Tabs } from '../ui/WorkspaceTabs';
import { ApproveWork } from './ApproveWork';
import { ChangedFiles } from './ChangedFiles';
import { DecisionAdvice } from './DecisionAdvice';
import { ProjectVerification } from './ProjectVerification';
import { ReviewActions } from './ReviewActions';
import { ReviewFeedback } from './ReviewFeedback';
import './result-review.css';

export type ReviewSection = 'changes' | 'checks' | 'delivery';

export function ResultReview({
  run,
  onCorrect,
  outcomes,
  evidence,
  visible = true,
  review: suppliedReview,
  onRefresh,
  delivery,
  unavailable,
  section,
  onSectionChange,
  canApprove = true,
}: {
  run: TaskRun;
  onCorrect?: (prompt: string) => void | Promise<void>;
  outcomes?: ReactNode;
  evidence?: ReactNode;
  visible?: boolean;
  review?: Review;
  onRefresh?: () => void | Promise<void>;
  delivery?: ReactNode;
  unavailable?: ReactNode;
  section?: ReviewSection;
  onSectionChange?: (section: ReviewSection) => void;
  canApprove?: boolean;
}) {
  const [selected, setSelected] = useState<ReviewSection>('changes');
  const hasChecks = !unavailable || !!outcomes || !!evidence;
  const requested = section ?? selected;
  const current = requested === 'checks' && !hasChecks ? 'changes' : requested;
  const [loadedReview, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const review = suppliedReview ?? loadedReview;
  const { projects } = useProjectStore();
  const project = projects.find((p) => p.id === run.projectId);
  const changeSection = (value: ReviewSection) => {
    setSelected(value);
    onSectionChange?.(value);
  };
  const workflowSteps = run.contract?.requirements.filter((item) => item.checkpoint).length ?? 0;
  const unfinishedWorkflow = (run.contract?.step ?? 0) + 1 < workflowSteps;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (suppliedReview) await onRefresh?.();
      else setReview(await nativeTask<Review>('task_review', { id: run.id }));
    } catch (error) {
      setError(String(error));
    } finally {
      setLoading(false);
    }
  }, [run.id, suppliedReview, onRefresh]);
  useEffect(() => {
    if (visible && !suppliedReview && !unavailable) void load();
  }, [load, visible, suppliedReview, unavailable]);
  const checkFailed = !!run.verificationError || run.verification?.result.success === false;
  return (
    <div className="task-review">
      <DecisionAdvice run={run} />
      <Tabs.Root
        value={current}
        onValueChange={(value) => {
          changeSection(value as ReviewSection);
        }}
      >
        <Tabs.List aria-label="Review sections">
          <Tabs.Trigger value="changes">
            <FileDiff size={16} aria-hidden="true" /> Changes
          </Tabs.Trigger>
          {hasChecks && (
            <Tabs.Trigger value="checks">
              <ListChecks size={16} aria-hidden="true" /> Checks{' '}
              {checkFailed && <span className="review-check-warning">Need attention</span>}
            </Tabs.Trigger>
          )}
          {delivery && (
            <Tabs.Trigger value="delivery">
              <GitMerge size={16} aria-hidden="true" /> Merge
            </Tabs.Trigger>
          )}
        </Tabs.List>
        <ReviewPanel current={current} value="changes">
          {unavailable || (
            <>
              <div className="task-review-toolbar">
                <h3 className="flex items-center gap-2 font-medium">
                  <FileDiff size={16} />
                  Changes{' '}
                  {review
                    ? `· ${review.files.length} ${review.files.length === 1 ? 'file' : 'files'}`
                    : ''}
                </h3>
                <div className="task-review-actions">
                  {review && <ReviewActions run={run} review={review} />}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading}
                    onClick={() => void load()}
                    loading={loading}
                    loadingLabel="Reading…"
                  >
                    <RefreshCw size={14} /> Refresh changes
                  </Button>
                  {canApprove && run.status === 'review' && !unfinishedWorkflow && (
                    <ApproveWork
                      run={run}
                      onApproved={() => changeSection(delivery ? 'delivery' : 'checks')}
                    />
                  )}
                  {canApprove && unfinishedWorkflow && (
                    <Button onClick={() => changeSection('checks')}>
                      Review outcomes <ArrowRight size={16} />
                    </Button>
                  )}
                  {canApprove &&
                    run.status === 'reviewed' &&
                    (delivery ? (
                      <Button onClick={() => changeSection('delivery')}>
                        Continue to merge <ArrowRight size={16} />
                      </Button>
                    ) : (
                      <span className="task-muted">
                        <Check size={16} /> Work approved
                      </span>
                    ))}
                </div>
              </div>
              {error && (
                <InlineNotice tone="error" className="mt-3">
                  {error}
                </InlineNotice>
              )}
              {loading && (
                <p role="status" className="task-muted">
                  Reading changes from this task’s workspace…
                </p>
              )}
              <section className="task-review-output" aria-label="Changed files">
                {review && (
                  <>
                    <ReviewFeedback
                      taskId={run.taskId}
                      revision={reviewFingerprint(review.diff)}
                      files={review.files}
                      onFeedback={onCorrect}
                    >
                      <ChangedFiles
                        files={review.files}
                        patch={review.diff}
                        visible={visible && current === 'changes'}
                        reviewId={run.id}
                      />
                    </ReviewFeedback>
                    {review.note && (
                      <Disclosure>
                        <DisclosureSummary>About these changes</DisclosureSummary>
                        <p className="task-muted">{review.note}</p>
                      </Disclosure>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </ReviewPanel>
        {hasChecks && (
          <ReviewPanel current={current} value="checks">
            <section className="task-review-checks" aria-label="Review checks">
              {!unavailable && (
                <ProjectVerification
                  run={run}
                  command={project?.preferences?.verifyCommand}
                  onCorrect={onCorrect}
                />
              )}
              {outcomes}
              {evidence}
            </section>
          </ReviewPanel>
        )}
        {delivery && (
          <ReviewPanel current={current} value="delivery">
            <div className="task-review-delivery">{delivery}</div>
          </ReviewPanel>
        )}
      </Tabs.Root>
    </div>
  );
}

function ReviewPanel({
  current,
  value,
  children,
}: {
  current: ReviewSection;
  value: ReviewSection;
  children: ReactNode;
}) {
  const [visited, setVisited] = useState(current === value);
  useEffect(() => {
    if (current === value) setVisited(true);
  }, [current, value]);
  return (
    <Tabs.Content value={value} forceMount hidden={current !== value}>
      {(visited || current === value) && children}
    </Tabs.Content>
  );
}
