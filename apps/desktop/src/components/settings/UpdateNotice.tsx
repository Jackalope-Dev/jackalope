import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { availableUpdateId, useUpdateStore } from '../../stores/updateStore';
import { returnToCompanion, useCompanionNotices } from '../mascot/useCompanionNotices';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';
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
  const version = availableUpdateId(update.release);
  const ready = !!version && update.downloadedVersion === version;
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
                : update.release?.storeManaged
                  ? 'A Jackalope update is available'
                  : `Jackalope ${version} is available`,
              detail: ready
                ? 'Downloaded and ready. Restart when your work is saved.'
                : 'Install now, or open the details first.',
              kind: 'info',
              actionLabel: ready
                ? 'Restart to update'
                : update.release?.storeManaged
                  ? 'Install update'
                  : 'Download and install',
              // Installing checks for active work natively; the details dialog
              // opens alongside so progress and any blocking reason stay visible.
              onOpen: () => {
                setOpen(true);
                void useUpdateStore.getState().install();
              },
              onDismiss: update.installing ? undefined : update.dismiss,
            },
          ]
        : [],
  );
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <DialogContent
        className="history-recovery-dialog"
        onCloseAutoFocus={returnToCompanion}
        aria-describedby={undefined}
      >
        <DialogCloseButton label="Close update details" />
        <DialogHeader title="App updates" />
        <UpdateSettings showHeading={false} />
      </DialogContent>
    </Dialog.Root>
  );
}
