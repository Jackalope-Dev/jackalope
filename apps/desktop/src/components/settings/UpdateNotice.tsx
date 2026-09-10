import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useUpdateStore } from '../../stores/updateStore';
import { returnToCompanion, useCompanionNotices } from '../mascot/useCompanionNotices';
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
  useCompanionNotices(
    'update',
    update.error
      ? [
          {
            id: `update-error:${update.error}`,
            title: 'Update needs attention',
            detail: update.error,
            kind: 'attention',
            actionLabel: 'Review update',
            onOpen: () => setOpen(true),
          },
        ]
      : version && update.dismissedVersion !== version
        ? [
            {
              id: `update:${version}`,
              title: update.installing
                ? 'Updating Jackalope…'
                : `Jackalope ${version} is available`,
              detail: 'Ready to install when your work is saved.',
              kind: 'info',
              actionLabel: 'Review update',
              onOpen: () => setOpen(true),
              onDismiss: update.installing ? undefined : update.dismiss,
            },
          ]
        : [],
  );
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content
          className="task-dialog appearance-panel history-recovery-dialog"
          onCloseAutoFocus={returnToCompanion}
          aria-describedby={undefined}
        >
          <Dialog.Close className="task-close" aria-label="Close update details">
            <X size={18} />
          </Dialog.Close>
          <Dialog.Title className="text-xl font-medium pr-10 mb-6">App updates</Dialog.Title>
          <UpdateSettings showHeading={false} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
