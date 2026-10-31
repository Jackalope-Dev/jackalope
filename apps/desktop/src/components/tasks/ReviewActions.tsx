import { IconButton, DropdownMenu as Menu } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { MoreHorizontal } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Review, TaskRun } from '../../lib/task-runtime';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';
import { CaptureTask } from './CaptureTask';
import { ChallengeDialog } from './ChallengeReview';
import { prepareCrossModelReview } from './CrossModelReviewPanel';
import { ReviewProgress } from './ReviewProgress';
import { TaskImpact } from './TaskImpact';
import { TaskUsefulness } from './TaskUsefulness';

const titles = {
  progress: 'Changes since last review',
  impact: 'Affected files',
  rating: 'Rate this result',
};
export function ReviewActions({
  run,
  review,
  onRefresh,
  onChallengeStarted,
}: {
  run: TaskRun;
  review: Review;
  onRefresh: () => void;
  onChallengeStarted?: () => void;
}) {
  const [tool, setTool] = useState<keyof typeof titles | null>(null);
  const [peerDraft, setPeerDraft] = useState<string>();
  const [challenging, setChallenging] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <IconButton ref={trigger} variant="outline" label="More review actions">
            <MoreHorizontal size={18} />
          </IconButton>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className="workspace-menu" align="end" sideOffset={8}>
            {!!review.diff && (
              <Menu.Item
                className="workspace-menu-item"
                onSelect={() =>
                  setPeerDraft(prepareCrossModelReview(run, review.files, review.diff))
                }
              >
                Ask another agent to review
              </Menu.Item>
            )}
            {!!review.diff && (
              <Menu.Item className="workspace-menu-item" onSelect={() => setChallenging(true)}>
                Challenge this change
              </Menu.Item>
            )}
            <Menu.Item className="workspace-menu-item" onSelect={onRefresh}>
              Refresh changes
            </Menu.Item>
            <Menu.Separator className="menu-separator" />
            {Object.entries(titles).map(([key, title]) => (
              <Menu.Item
                key={key}
                className="workspace-menu-item"
                onSelect={() => setTool(key as keyof typeof titles)}
              >
                {title}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <Dialog.Root
        open={!!tool}
        onOpenChange={(open) => {
          if (!open) setTool(null);
        }}
      >
        <DialogContent
          className="review-action-dialog"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DialogCloseButton />
          <DialogHeader title={tool ? titles[tool] : 'Review'} />
          {tool === 'progress' && <ReviewProgress runId={run.id} />}
          {tool === 'impact' && <TaskImpact run={run} files={review.files} />}
          {tool === 'rating' && <TaskUsefulness runId={run.id} expanded />}
        </DialogContent>
      </Dialog.Root>
      {challenging && (
        <ChallengeDialog
          run={run}
          returnFocus={trigger}
          onClose={() => setChallenging(false)}
          onStarted={() => {
            setChallenging(false);
            onChallengeStarted?.();
          }}
        />
      )}
      {peerDraft && (
        <CaptureTask
          draftKey={peerDraft}
          onClose={() => setPeerDraft(undefined)}
          onStarted={() => setPeerDraft(undefined)}
        />
      )}
    </>
  );
}
