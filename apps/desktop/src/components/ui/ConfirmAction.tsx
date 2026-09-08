import * as Dialog from '@radix-ui/react-dialog';
import { type ReactNode, useState } from 'react';
import { Button } from './button';

export function ConfirmAction({
  trigger,
  title,
  description,
  label = 'Delete',
  busyLabel = 'Deleting…',
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  label?: string;
  busyLabel?: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      setOpen(false);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          setOpen(value);
          setError('');
        }
      }}
    >
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay confirm-action-overlay" />
        <Dialog.Content className="task-dialog appearance-panel confirm-action-dialog">
          <Dialog.Title className="text-xl font-medium">{title}</Dialog.Title>
          <Dialog.Description className="task-muted mt-3">{description}</Dialog.Description>
          {error && (
            <p role="alert" className="task-error mt-4">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-3 mt-6">
            <Dialog.Close asChild>
              <Button variant="outline" disabled={busy}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button variant="danger" disabled={busy} onClick={() => void confirm()}>
              {busy ? busyLabel : label}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
