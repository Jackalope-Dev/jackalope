import type { Review } from '@jackalope/contracts/runs';
import {
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  IconButton,
  DropdownMenu as Menu,
} from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import {
  FileDiff,
  type LucideIcon,
  MoreHorizontal,
  RefreshCw,
  Star,
  Swords,
  Waypoints,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type { TaskRun } from '../../lib/run-types';
import { ChallengeDialog } from './ChallengeReview';
import { ReviewProgress } from './ReviewProgress';
import { TaskImpact } from './TaskImpact';
import { TaskUsefulness } from './TaskUsefulness';

const titles = {
  progress: 'Changes since last review',
  impact: 'Affected files',
  rating: 'Rate this result',
};
const icons: Record<keyof typeof titles, LucideIcon> = {
  progress: FileDiff,
  impact: Waypoints,
  rating: Star,
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
            <Menu.Item className="workspace-menu-item" onSelect={onRefresh}>
              <RefreshCw size={16} aria-hidden="true" />
              Refresh changes
            </Menu.Item>
            {!!review.diff && (
              <Menu.Item className="workspace-menu-item" onSelect={() => setChallenging(true)}>
                <Swords size={16} aria-hidden="true" />
                Challenge this change
              </Menu.Item>
            )}
            <Menu.Separator className="menu-separator" />
            {(Object.keys(titles) as (keyof typeof titles)[]).map((key) => {
              const Icon = icons[key];
              return (
                <Menu.Item key={key} className="workspace-menu-item" onSelect={() => setTool(key)}>
                  <Icon size={16} aria-hidden="true" />
                  {titles[key]}
                </Menu.Item>
              );
            })}
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
    </>
  );
}
