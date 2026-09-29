import { DropdownMenu as Menu } from '@jackalope/ui';
import { Check, ChevronDown, Columns3, Hammer, Scan } from 'lucide-react';
import { workspacePresets } from '../../lib/workbench';
import { useExecutionStore } from '../../stores/executionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { useWorkbenchStore } from '../../stores/workbenchStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import '../tasks/workbench.css';
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
          {workspacePresets.map((item) => {
            const ItemIcon = item.id === 'focus' ? Scan : item.id === 'build' ? Hammer : Columns3;
            const isSelected = preset === item.id;
            return (
              <Menu.Item
                key={item.id}
                className="work-preset-item"
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
                <ItemIcon size={18} className="work-preset-icon" aria-hidden="true" />
                <div className="work-preset-body">
                  <span className="work-preset-title">{item.label}</span>
                  <span className="work-preset-desc">{item.description}</span>
                </div>
                <Check
                  size={16}
                  className={`work-preset-check${isSelected ? '' : ' work-preset-check-hidden'}`}
                  aria-hidden="true"
                />
              </Menu.Item>
            );
          })}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
