import { DropdownMenu as Menu } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, SquareTerminal } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { sessionCommand } from '../../lib/live-session';
import { nativeTask, type TaskRun } from '../../lib/task-runtime';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';
import { InlineNotice } from '../ui/InlineNotice';

const TaskTerminal = lazy(() =>
  import('./TaskTerminal').then((m) => ({ default: m.TaskTerminal })),
);

export function WorkTools({ run, requestRevision }: { run: TaskRun; requestRevision?: number }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (requestRevision) setOpen(true);
  }, [requestRevision]);
  const act = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(String(cause));
    }
  };
  return (
    <>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <Button variant="outline">
            <SquareTerminal size={16} aria-hidden="true" />
            Terminal
          </Button>
        </Dialog.Trigger>
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
            {(['result', 'changes', 'preview', 'terminal'] as const).map((pane) => (
              <Menu.Item
                key={pane}
                onSelect={() =>
                  void act(async () => {
                    if (run.liveSessionId && ['changes', 'preview'].includes(pane))
                      await sessionCommand('action', { id: run.liveSessionId, action: 'pause' });
                    await nativeTask('task_work_window', { id: run.id, pane, action: 'open' });
                  })
                }
              >
                Pop out {pane === 'changes' ? 'review' : pane}
              </Menu.Item>
            ))}
            <Menu.Separator />
            {(['vscode', 'cursor'] as const).map((editor) => (
              <Menu.Item
                key={editor}
                onSelect={() =>
                  void act(() => nativeTask('task_open_editor', { id: run.id, editor }))
                }
              >
                Open in {editor === 'vscode' ? 'VS Code' : 'Cursor'}
              </Menu.Item>
            ))}
            <Menu.Item
              onSelect={() => void act(() => navigator.clipboard.writeText(run.workspace))}
            >
              Copy workspace path
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </>
  );
}
