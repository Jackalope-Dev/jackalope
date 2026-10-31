import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import { ArrowRight, Check, FileDiff, GitMerge, Images, ListChecks, RefreshCw } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { capturedPages, type ReviewCaptures } from '../../lib/review-captures';
import { reviewFingerprint } from '../../lib/review-fingerprint';
import { nativeTask, type Review, type TaskRun } from '../../lib/task-runtime';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { WorkspaceTabs as Tabs } from '../ui/WorkspaceTabs';
import { ApproveWork } from './ApproveWork';
import { ChallengeFindings } from './ChallengeReview';
import { ChangedFiles } from './ChangedFiles';
import { DecisionAdvice } from './DecisionAdvice';
import { ProjectVerification } from './ProjectVerification';
import { ReviewActions } from './ReviewActions';
import { ReviewFeedback } from './ReviewFeedback';
import { ReviewScreenshots } from './ReviewScreenshots';
import './result-review.css';

export type ReviewSection = 'changes' | 'screenshots' | 'checks' | 'delivery';

const EMPTY_CAPTURES: ReviewCaptures = {
  capturedAt: '',
  beforeAvailable: false,
  pages: [],
  notes: [],
};

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
  onOpenPreview,
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
  /** Shows the task's live preview, from the screenshots view. */
  onOpenPreview?: () => void;
  canApprove?: boolean;
}) {
  const [selected, setSelected] = useState<ReviewSection>('changes');
  const hasChecks = !unavailable || !!outcomes || !!evidence;
  const capturing = !!run.reviewCapturing;
  const captures = run.reviewCaptures ?? (capturing ? EMPTY_CAPTURES : undefined);
  const shots = capturedPages(captures).length;
  const hasScreenshots = capturing || (!!captures && (shots > 0 || captures.notes.length > 0));
  const requested = section ?? selected;
  const current =
    (requested === 'checks' && !hasChecks) || (requested === 'screenshots' && !hasScreenshots)
      ? 'changes'
      : requested;
  const [feedbackSlot, setFeedbackSlot] = useState<HTMLDivElement | null>(null);
  // Review actions share the section switcher's row instead of adding a toolbar row.
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null);
  const [loadedReview, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const review = suppliedReview ?? loadedReview;
  const { projects } = useProjectStore(useShallow((s) => ({ projects: s.projects })));
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
        <div className="review-header">
          <Tabs.List aria-label="Review sections">
            <Tabs.Trigger value="changes">
              <FileDiff size={16} aria-hidden="true" /> Changes
              {review ? <span className="ui-segment-count">{review.files.length}</span> : null}
            </Tabs.Trigger>
            {hasScreenshots && (
              <Tabs.Trigger value="screenshots">
                <Images size={16} aria-hidden="true" /> Screenshots
                {shots > 0 && <span className="ui-segment-count">{shots}</span>}
              </Tabs.Trigger>
            )}
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
          <div ref={setActionSlot} className="review-header-actions" />
        </div>
        <ReviewPanel current={current} value="changes">
          {unavailable || (
            <>
              {portalActions(
                <div className="task-review-actions">
                  <div ref={setFeedbackSlot} className="review-feedback-slot" />
                  {review ? (
                    <ReviewActions
                      run={run}
                      review={review}
                      onRefresh={() => void load()}
                      onChallengeStarted={() => changeSection('checks')}
                    />
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Refresh changes"
                      title="Refresh changes"
                      disabled={loading}
                      aria-busy={loading || undefined}
                      onClick={() => void load()}
                    >
                      <RefreshCw size={16} aria-hidden="true" />
                    </Button>
                  )}
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
                </div>,
                current === 'changes' ? actionSlot : null,
              )}
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
                      toolbarTarget={feedbackSlot}
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
        {hasScreenshots && captures && (
          <ReviewPanel current={current} value="screenshots">
            <ReviewScreenshots
              runId={run.id}
              captures={captures}
              capturing={capturing}
              onOpenPreview={onOpenPreview}
            />
          </ReviewPanel>
        )}
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
              <ChallengeFindings run={run} onCorrect={onCorrect} />
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

/** Renders into the section header when it is available, otherwise in place. */
function portalActions(actions: ReactNode, target: HTMLElement | null) {
  return target ? createPortal(actions, target) : actions;
}
