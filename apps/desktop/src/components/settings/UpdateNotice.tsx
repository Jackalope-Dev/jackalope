import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useUpdateStore } from '../../stores/updateStore';
import { Button } from '../ui/button';
import { UpdateSettings } from './UpdateSettings';

export function UpdateNotice() {
  const update = useUpdateStore();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void update.load();
    const check = () => {
      if (document.visibilityState === 'visible') void useUpdateStore.getState().check(true);
    };
    const startup = window.setTimeout(check, 10_000);
    const interval = window.setInterval(check, 60_000);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearTimeout(startup);
      window.clearInterval(interval);
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [update.load]);
  const version = update.release?.availableVersion;
  if (!open && (!version || update.dismissedVersion === version)) return null;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <div className="flex flex-wrap shrink-0 items-center gap-3 px-6 py-2 text-sm bg-[var(--color-surface-elevated)] border-b border-[var(--color-border)]">
        <p className="flex-1 min-w-0" role="status">
          {update.installing
            ? 'Updating Jackalope…'
            : version
              ? `Jackalope ${version} is available.`
              : 'Jackalope is up to date.'}
        </p>
        <Dialog.Trigger asChild>
          <Button variant="ghost">Review update</Button>
        </Dialog.Trigger>
        <Button variant="ghost" disabled={update.installing} onClick={update.dismiss}>
          Later
        </Button>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content className="task-dialog appearance-panel history-recovery-dialog">
          <Dialog.Close className="task-close" aria-label="Close update details">
            <X size={18} />
          </Dialog.Close>
          <Dialog.Title className="text-xl font-medium pr-10">
            Keep Jackalope up to date
          </Dialog.Title>
          <Dialog.Description className="task-muted mt-3 mb-6">
            Review what’s new and install when your work is saved.
          </Dialog.Description>
          <UpdateSettings />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
