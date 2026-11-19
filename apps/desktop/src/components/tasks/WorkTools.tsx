import {
  Button,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DropdownMenu as Menu,
  Tooltip,
} from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, PictureInPicture2, SquareTerminal } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useAction } from '../../hooks/useAction';
import { sessionCommand } from '../../lib/live-session';
import { invokeNative } from '../../lib/native/transport';
import type { TaskRun } from '../../lib/run-types';
import { useSettingsStore } from '../../stores/settingsStore';
import { ActionError } from '../ui/ActionError';

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
  const { editor, more, popOuts, error } = useWorkspaceActions(run);
  // This toolbar has no panels to carry pop-out buttons, so it keeps them in its menu.
  const groups = [popOuts, [...(editor ? [editor] : []), ...more]].filter((group) => group.length);
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
      <ActionError error={error} />
    </>
  );
}

type WorkspaceAction = { id: string; label: string; onSelect: () => void };

/** Task panels that open in a window of their own. */
const POP_OUT_PANES = ['result', 'changes', 'preview', 'terminal'] as const;
export type PopOutPane = (typeof POP_OUT_PANES)[number];

export const isPopOutPane = (value: string): value is PopOutPane =>
  (POP_OUT_PANES as readonly string[]).includes(value);

const popOutLabel = (pane: PopOutPane) => `Pop out ${pane === 'changes' ? 'review' : pane}`;

/**
 * Workspace commands for a run: the preferred editor on its own, the other editor and copy
 * commands for an "Open in…" submenu, and pop-out windows for panels (see PopOutButton).
 */
export function useWorkspaceActions(run?: TaskRun) {
  const { run: act, error } = useAction();
  const preferredEditor = useSettingsStore((state) => state.preferredEditor);
  if (!run)
    return {
      editor: undefined,
      more: [] as WorkspaceAction[],
      popOuts: [] as WorkspaceAction[],
      popOut: undefined,
      error,
    };
  const popOut = (pane: PopOutPane) =>
    void act(async () => {
      if (run.liveSessionId && ['changes', 'preview'].includes(pane))
        await sessionCommand('action', { id: run.liveSessionId, action: 'pause' });
      await invokeNative('task_work_window', { id: run.id, pane, action: 'open' });
    });
  const popOuts: WorkspaceAction[] = POP_OUT_PANES.map((pane) => ({
    id: `pop-${pane}`,
    label: popOutLabel(pane),
    onSelect: () => popOut(pane),
  }));
  const [editor, ...otherEditors]: WorkspaceAction[] = [...(['vscode', 'cursor'] as const)]
    .sort((a) => (a === preferredEditor ? -1 : 1))
    .map((name) => ({
      id: name,
      label: `Open in ${name === 'vscode' ? 'VS Code' : 'Cursor'}`,
      onSelect: () =>
        void act(() => invokeNative('task_open_editor', { id: run.id, editor: name })),
    }));
  const more: WorkspaceAction[] = [
    ...otherEditors,
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
  return { editor, more, popOuts, popOut, error };
}

/** Opens a panel in its own window; it sits with the panel's tabs. */
export function PopOutButton({
  pane,
  onPopOut,
}: {
  pane: PopOutPane;
  onPopOut: (pane: PopOutPane) => void;
}) {
  const label = popOutLabel(pane);
  return (
    <Tooltip content={label}>
      <Button variant="ghost" size="icon" aria-label={label} onClick={() => onPopOut(pane)}>
        <PictureInPicture2 size={16} aria-hidden="true" />
      </Button>
    </Tooltip>
  );
}
