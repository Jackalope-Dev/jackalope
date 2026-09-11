import * as Dialog from '@radix-ui/react-dialog';
import { type ReactNode, useState } from 'react';
import { Button } from './button';
import { DialogContent, DialogFooter, DialogHeader } from './Dialog';
import { InlineNotice } from './InlineNotice';

export function ConfirmAction({
  trigger,
  title,
  description,
  label = 'Delete',
  busyLabel = 'Deleting…',
  onConfirm,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: ReactNode;
  title: string;
  description: string;
  label?: string;
  busyLabel?: string;
  onConfirm: () => void | Promise<void>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (value: boolean) => {
    setLocalOpen(value);
    onOpenChange?.(value);
  };
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
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <DialogContent overlayClassName="confirm-action-overlay" className="confirm-action-dialog">
        <DialogHeader title={title} description={description} />
        {error && (
          <InlineNotice tone="error" className="mt-4">
            {error}
          </InlineNotice>
        )}
        <DialogFooter>
          <Dialog.Close asChild>
            <Button variant="outline" disabled={busy}>
              Cancel
            </Button>
          </Dialog.Close>
          <Button variant="danger" disabled={busy} onClick={() => void confirm()}>
            {busy ? busyLabel : label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}
