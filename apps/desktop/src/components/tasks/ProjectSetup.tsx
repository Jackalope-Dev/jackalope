import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, FolderOpen, X } from 'lucide-react';
import { useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { AgentManager } from '../agents/AgentManager';
import { syncAgentConfig } from '../../stores/agentConfigStore';
import { Button } from '../ui/button';
import { useDialogFocus } from '../ui/useDialogFocus';

export function ProjectSetup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogFocus = useDialogFocus();
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { useMcpMarketplace, setUseMcpMarketplace } =
    useSettingsStore();
  const desktop = isTauriEnvironment();
  const browse = async () => {
    setError('');
    try {
      const selected = await nativeTask<string | null>('task_pick_project');
      if (selected) setPath(selected);
    } catch (error) {
      setError(String(error));
    }
  };
  const add = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await syncAgentConfig();
      const info = await nativeTask<{ path: string; name: string; branch: string }>(
        'task_validate_project',
        { path: path.trim() },
      );
      const store = useProjectStore.getState();
      const existing = store.projects.find(
        (p) =>
          p.path.replaceAll('\\', '/').toLowerCase() ===
          info.path.replaceAll('\\', '/').toLowerCase(),
      );
      if (existing) {
        store.selectProject(existing.id);
        import('../../stores/contextMemoryStore')
          .then(({ useContextMemoryStore }) => {
            void useContextMemoryStore.getState().refreshMemory(existing);
          })
          .catch(() => {});
      } else {
        const newProj = {
          id: crypto.randomUUID(),
          name: info.name,
          path: info.path,
          gitBranch: info.branch || 'Detached HEAD',
          agentProvider: 'codex' as const,
        };
        await store.addProject(newProj);
        import('../../stores/contextMemoryStore')
          .then(({ useContextMemoryStore }) => {
            void useContextMemoryStore.getState().refreshMemory(newProj);
          })
          .catch(() => {});
      }
      setPath('');
      onClose();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content {...dialogFocus} className="task-dialog appearance-panel">
          <Dialog.Close className="task-close" aria-label="Close project setup" disabled={busy}>
            <X size={18} />
          </Dialog.Close>
          <FolderOpen className="text-[var(--color-accent-ink)] mb-5" size={26} />
          <Dialog.Title className="text-2xl font-medium tracking-tight">
            Bring your project.
          </Dialog.Title>
          <Dialog.Description className="task-muted mt-3 mb-7">
            Choose a local Git repository. Jackalope keeps each task attached to its project and
            gives new work its own branch.
          </Dialog.Description>
          {!desktop && (
            <p className="task-notice">
              Project access is available in the desktop app. The browser preview cannot read your
              files.
            </p>
          )}
          <details className="mb-5">
            <summary className="task-summary">Set up agents & models</summary>
            <div className="mt-4">
              <AgentManager />
            </div>
          </details>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
          >
            <label htmlFor="project-path" className="task-label">
              Repository folder
            </label>
            <div className="flex gap-2 mt-2">
              <input
                id="project-path"
                className="task-input flex-1 min-w-0"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="Paste a repository path"
                disabled={!desktop || busy}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void browse()}
                disabled={!desktop || busy}
              >
                Browse
              </Button>
            </div>
            {error && (
              <p role="alert" className="task-error mt-4">
                {error}
              </p>
            )}
            <div className="mt-5 pt-4 border-t border-[var(--color-border)]">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useMcpMarketplace}
                  onChange={(e) => setUseMcpMarketplace(e.target.checked)}
                  className="mt-0.5 rounded border-[var(--color-border)] text-[var(--color-accent-ink)]"
                />
                <div>
                  <span className="text-sm font-medium text-[var(--color-text-primary)]">
                    Use MCP marketplace (allmcps.com)
                  </span>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    Allow Jackalope to search and 1-click install community MCP tools. Jackalope
                    does not transmit your source code or prompts.
                  </p>
                </div>
              </label>
            </div>
            <p className="task-muted text-xs mt-4">This build does not send usage telemetry or crash reports.</p>
            <div className="flex justify-end mt-7">
              <Button type="submit" disabled={!desktop || !path.trim() || busy}>
                {busy ? 'Checking repository…' : 'Open project'}
                <ArrowRight size={15} />
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
