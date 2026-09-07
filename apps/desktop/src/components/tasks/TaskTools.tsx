import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { AgentManager } from '../agents/AgentManager';
import { McpWorkspace } from '../mcp/McpWorkspace';
import { ProjectPreferences } from '../projects/ProjectPreferences';
import { Button } from '../ui/button';
import { useDialogFocus } from '../ui/useDialogFocus';

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
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content {...focus} className="task-dialog appearance-panel task-tools-dialog">
          <Dialog.Title className="text-xl pr-10">Set up what this task needs</Dialog.Title>
          <Dialog.Description className="task-muted mt-2">
            Your task and draft stay in place.{' '}
            {project ? `Settings for ${project.name}.` : 'Choose an agent or connect a service.'}
          </Dialog.Description>
          <Dialog.Close asChild>
            <Button variant="ghost" className="task-close" aria-label="Close task setup">
              <X size={18} />
            </Button>
          </Dialog.Close>
          <nav className="result-tabs mt-4" aria-label="Task setup">
            {['connections', 'agents', 'project'].map((value) => (
              <button
                key={value}
                type="button"
                aria-current={tab === value ? 'page' : undefined}
                onClick={() => setTab(value)}
              >
                {value === 'connections'
                  ? 'Connections'
                  : value === 'agents'
                    ? 'Agents'
                    : 'Project defaults'}
              </button>
            ))}
          </nav>
          {tab === 'connections' && <McpWorkspace />}
          {tab === 'project' && <ProjectPreferences />}
          {tab === 'agents' && <AgentManager />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
