import { DropdownMenu as Menu } from '@jackalope/ui';
import { Check, PanelsTopLeft } from 'lucide-react';
import { workspacePresets } from '../../lib/workbench';
import { useExecutionStore } from '../../stores/executionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { useWorkbenchStore } from '../../stores/workbenchStore';
import { defaultWorkView, useWorkViewStore } from '../../stores/workViewStore';
import { navigateWorkspace } from './navigation';

export function WorkspacePresetPicker({ projectId }: { projectId: string }) {
  const preset = useWorkbenchStore((state) => state.presets[projectId] ?? 'focus');
  return (
    <Menu.Root>
      <Menu.Trigger className="command-trigger" aria-label="Workspace layout">
        <PanelsTopLeft size={16} />
        <span>{workspacePresets.find((item) => item.id === preset)?.label}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" className="work-preset-menu">
          {workspacePresets.map((item) => (
            <Menu.Item
              key={item.id}
              onSelect={() => {
                useWorkbenchStore.getState().setPreset(projectId, item.id);
                useWorkViewStore.getState().resetSplits([
                  ...useExecutionStore
                    .getState()
                    .runs.filter((run) => run.projectId === projectId)
                    .map((run) => run.taskId),
                  ...useLiveSessionStore
                    .getState()
                    .sessions.filter((session) => session.request.projectId === projectId)
                    .map((session) => `session:${session.id}`),
                  ...(useManagedTaskStore.getState().queue.managedTasks ?? [])
                    .filter((task) => task.request.projectId === projectId)
                    .map((task) => `managed:${task.id}`),
                ]);
                if (item.id === 'oversee') {
                  const views = useWorkViewStore.getState();
                  views.setScope('project');
                  views.setView(`${projectId}:current`, {
                    ...defaultWorkView,
                    filter: 'attention',
                  });
                  useExecutionStore.getState().select(null);
                  useManagedTaskStore.getState().select(null);
                  navigateWorkspace('kanban');
                }
              }}
            >
              <span>
                <strong>
                  {item.label}
                  {preset === item.id && <Check size={14} />}
                </strong>
                <small>{item.description}</small>
              </span>
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
