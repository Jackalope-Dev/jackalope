import type { Runner } from '../../lib/task-runtime';
import type { Project } from '../../stores/projectStore';
import { FeaturePlanner } from './FeaturePlanner';

interface Props {
  open: boolean;
  onClose: () => void;
  goal: string;
  project: Project;
  runners: Runner[];
  onImported?: () => void;
}

export function MultiAgentSplitDialog({ open, onClose, goal, project, onImported }: Props) {
  if (!open) return null;
  return (
    <FeaturePlanner
      project={project}
      initialGoal={goal}
      multiAgent
      onClose={onClose}
      onAdded={async () => {
        onImported?.();
      }}
    />
  );
}
