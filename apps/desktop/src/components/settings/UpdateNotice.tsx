import { DialogCloseButton, DialogContent, DialogHeader } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect } from 'react';
import { availableUpdateId, useUpdateStore } from '../../stores/updateStore';
import { returnToCompanion, useCompanionNotices } from '../mascot/useCompanionNotices';
import { useUpdateBlockers } from './UpdateBlockers';
import { UpdateSettings } from './UpdateSettings';

export function UpdateNotice() {
  const update = useUpdateStore();
  const open = update.detailsOpen;
  const setOpen = update.showDetails;
  const blocked = useUpdateBlockers().length > 0;
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
              // The details dialog opens alongside so progress stays visible; while tasks
              // block the install it lists them instead of trying and failing.
              onOpen: () => {
                setOpen(true);
                if (!blocked) void useUpdateStore.getState().install();
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
