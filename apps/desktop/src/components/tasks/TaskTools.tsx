import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { AgentManager } from '../agents/AgentManager';
import { McpWorkspace } from '../mcp/McpWorkspace';
import { ProjectPreferences } from '../projects/ProjectPreferences';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';
import { useDialogFocus } from '../ui/useDialogFocus';
import { WorkspaceSubnavigation } from '../ui/WorkspaceSubnavigation';

export function TaskTools({ onClose }: { onClose: () => void }) {
  const focus = useDialogFocus();
  const [tab, setTab] = useState('connections');
  const project = useProjectStore((state) =>
    state.projects.find((p) => p.id === state.activeProjectId),
  );
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent {...focus} className="task-tools-dialog">
        <DialogHeader
          title="Agents & project tools"
          description={
            <>
              Your task and draft stay in place.{' '}
              {project
                ? `These defaults apply to tasks in ${project.name}.`
                : 'Choose an agent or connect a service.'}
            </>
          }
        />
        <DialogCloseButton label="Close task setup" />
        <WorkspaceSubnavigation
          label="Task setup"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'connections', label: 'Connections' },
            { id: 'agents', label: 'Agents' },
            { id: 'project', label: 'Project defaults' },
          ]}
        />
        {tab === 'connections' && <McpWorkspace />}
        {tab === 'project' && <ProjectPreferences />}
        {tab === 'agents' && <AgentManager />}
      </DialogContent>
    </Dialog.Root>
  );
}
