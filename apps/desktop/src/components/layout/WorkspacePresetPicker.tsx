import { DropdownMenu as Menu } from '@jackalope/ui';
import { Check, ChevronDown, Columns3, Hammer, Scan } from 'lucide-react';
import { workspacePresets } from '../../lib/workbench';
import { useExecutionStore } from '../../stores/executionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { useWorkbenchStore } from '../../stores/workbenchStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { navigateWorkspace } from './navigation';

export function WorkspacePresetPicker({ projectId }: { projectId: string }) {
  const preset = useWorkbenchStore((state) => state.presets[projectId] ?? 'focus');
  const Icon = preset === 'focus' ? Scan : preset === 'build' ? Hammer : Columns3;
  return (
    <Menu.Root>
      <Menu.Trigger
        className="command-trigger workspace-mode-trigger"
        aria-label="Workspace layout"
      >
        <Icon size={16} />
        <span>{workspacePresets.find((item) => item.id === preset)?.label}</span>
        <ChevronDown size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" className="work-preset-menu">
          {workspacePresets.map((item) => (
            <Menu.Item
              key={item.id}
              onSelect={() => {
                const execution = useExecutionStore.getState();
                const sessions = useLiveSessionStore.getState();
                const managed = useManagedTaskStore.getState();
                const views = useWorkViewStore.getState();
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
                  views.setScope('project');
                  execution.select(null);
                  sessions.select(null);
                  managed.select(null);
                } else {
                  const id = managed.selectedId
                    ? `managed:${managed.selectedId}`
                    : sessions.selectedId
                      ? `session:${sessions.selectedId}`
                      : execution.selectedId;
                  if (id) views.open(id, item.id === 'build' ? 'changes' : 'result');
                }
                navigateWorkspace('kanban');
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
