import { DropdownMenu as Menu } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, SquareTerminal } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { sessionCommand } from '../../lib/live-session';
import { nativeTask, type TaskRun } from '../../lib/task-runtime';
import { useSettingsStore } from '../../stores/settingsStore';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';
import { InlineNotice } from '../ui/InlineNotice';

const TaskTerminal = lazy(() =>
  import('./TaskTerminal').then((m) => ({ default: m.TaskTerminal })),
);

export function WorkTools({
  run,
  requestRevision,
  onTerminal,
  hideTerminal = false,
}: {
  run: TaskRun;
  requestRevision?: number;
  onTerminal?: () => void;
  hideTerminal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { groups, error } = useWorkspaceActions(run);
  useEffect(() => {
    if (requestRevision && !onTerminal) setOpen(true);
  }, [requestRevision, onTerminal]);
  return (
    <>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        {hideTerminal ? null : onTerminal ? (
          <Button variant="outline" onClick={onTerminal}>
            <SquareTerminal size={16} aria-hidden="true" /> Terminal
          </Button>
        ) : (
          <Dialog.Trigger asChild>
            <Button variant="outline">
              <SquareTerminal size={16} aria-hidden="true" />
              Terminal
            </Button>
          </Dialog.Trigger>
        )}
        <DialogContent
          className="work-terminal-dialog"
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            if (event.target instanceof HTMLElement && event.target.closest('.xterm'))
              event.preventDefault();
          }}
        >
          <DialogCloseButton />
          <DialogHeader title="Task terminal" />
          <Suspense fallback={<p role="status">Loading terminal…</p>}>
            <TaskTerminal run={run} />
          </Suspense>
        </DialogContent>
      </Dialog.Root>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button variant="ghost">
            Workspace tools
            <ChevronDown size={14} aria-hidden="true" />
          </Button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className="workspace-menu" align="end">
            {groups.map((group, index) => [
              index > 0 && <Menu.Separator key={`separator-${group[0]?.id}`} />,
              ...group.map((action) => (
                <Menu.Item key={action.id} onSelect={action.onSelect}>
                  {action.label}
                </Menu.Item>
              )),
            ])}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </>
  );
}

type WorkspaceAction = { id: string; label: string; onSelect: () => void };

/** Pop-out windows, then editors and the workspace path, for a run. */
export function useWorkspaceActions(run?: TaskRun) {
  const [error, setError] = useState('');
  const preferredEditor = useSettingsStore((state) => state.preferredEditor);
  if (!run) return { groups: [] as WorkspaceAction[][], error };
  const act = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(String(cause));
    }
  };
  const windows: WorkspaceAction[] = (['result', 'changes', 'preview', 'terminal'] as const).map(
    (pane) => ({
      id: `pop-${pane}`,
      label: `Pop out ${pane === 'changes' ? 'review' : pane}`,
      onSelect: () =>
        void act(async () => {
          if (run.liveSessionId && ['changes', 'preview'].includes(pane))
            await sessionCommand('action', { id: run.liveSessionId, action: 'pause' });
          await nativeTask('task_work_window', { id: run.id, pane, action: 'open' });
        }),
    }),
  );
  const workspace: WorkspaceAction[] = [
    ...[...(['vscode', 'cursor'] as const)]
      .sort((a) => (a === preferredEditor ? -1 : 1))
      .map((editor) => ({
        id: editor,
        label: `Open in ${editor === 'vscode' ? 'VS Code' : 'Cursor'}${editor === preferredEditor ? ' (preferred)' : ''}`,
        onSelect: () => void act(() => nativeTask('task_open_editor', { id: run.id, editor })),
      })),
    {
      id: 'copy-path',
      label: 'Copy workspace path',
      onSelect: () => void act(() => navigator.clipboard.writeText(run.workspace)),
    },
    ...(run.branch
      ? [
          {
            id: 'copy-branch',
            label: 'Copy branch name',
            onSelect: () => void act(() => navigator.clipboard.writeText(run.branch)),
          },
        ]
      : []),
  ];
  return { groups: [windows, workspace], error };
}
