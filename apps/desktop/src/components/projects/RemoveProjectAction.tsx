import type { ReactNode } from 'react';
import { useExecutionStore } from '../../stores/executionStore';
import { useMascotStore } from '../../stores/mascotStore';
import { type Project, useProjectStore } from '../../stores/projectStore';
import { ConfirmAction } from '../ui/ConfirmAction';

export function RemoveProjectAction({
  project,
  trigger,
  open,
  onOpenChange,
}: {
  project: Project;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <ConfirmAction
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      title={`Remove ${project.name} from Jackalope?`}
      description="Your files, Git branches, worktrees and task history stay intact. Running tasks continue. You can add the folder again anytime."
      label="Remove from Jackalope"
      busyLabel="Removing…"
      onConfirm={() => {
        const execution = useExecutionStore.getState();
        if (execution.drafts.capture?.projectId === project.id) {
          execution.draft('capture', {
            projectId: '',
            model: undefined,
            contextSelection: undefined,
            connectionIds: undefined,
          });
        }
        useProjectStore.getState().removeProject(project.id);
        useMascotStore.getState().say(`${project.name} removed from Jackalope. Files kept.`, 4000);
      }}
    />
  );
}
