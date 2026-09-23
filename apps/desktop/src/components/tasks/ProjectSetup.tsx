import { Checkbox, Input } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { openProject } from '../../lib/project-setup';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogFooter, DialogHeader } from '../ui/Dialog';
import { InlineNotice } from '../ui/InlineNotice';
import { useDialogFocus } from '../ui/useDialogFocus';

export function ProjectSetup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogFocus = useDialogFocus();
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { useMcpMarketplace, setUseMcpMarketplace } = useSettingsStore();
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
      const project = await openProject(path, { provisional: true });
      const onboarding = useOnboardingStore.getState();
      onboarding.begin(project.id);
      onboarding.stageProject(project);
      onboarding.go('agent');
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
      <DialogContent {...dialogFocus}>
        <DialogCloseButton disabled={busy} label="Close project setup" />
        <FolderOpen className="text-[var(--color-accent-ink)] mb-5" size={26} />
        <DialogHeader
          title="Bring your project."
          description={
            <>
              Choose a local Git repository. Jackalope keeps each task attached to its project and
              gives new work its own branch.
            </>
          }
        />
        {!desktop && (
          <InlineNotice>
            Project access is available in the desktop app. The browser preview cannot read your
            files.
          </InlineNotice>
        )}
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
            <Input
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
            <InlineNotice tone="error" className="mt-4">
              {error}
            </InlineNotice>
          )}
          <div className="mt-5 pt-4 border-t border-[var(--color-border)]">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <Checkbox
                checked={useMcpMarketplace}
                onChange={(e) => setUseMcpMarketplace(e.target.checked)}
                className="mt-0.5 rounded border-[var(--color-border)] text-[var(--color-accent-ink)]"
              />
              <div>
                <span className="text-sm font-medium text-[var(--color-text-primary)]">
                  Use MCP marketplace (allmcps.com)
                </span>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  Allow Jackalope to search and 1-click install community MCP tools. Jackalope does
                  not transmit your source code or prompts.
                </p>
              </div>
            </label>
          </div>
          <p className="task-muted text-xs mt-4">
            This build does not send usage telemetry or crash reports.
          </p>
          <DialogFooter>
            <Button
              type="submit"
              disabled={!desktop || !path.trim() || busy}
              loading={busy}
              loadingLabel="Checking repository…"
            >
              Continue setup
              <ArrowRight size={15} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog.Root>
  );
}
