import * as Dialog from '@radix-ui/react-dialog';
import { type ComponentPropsWithoutRef, type ReactNode, useRef, useState } from 'react';
import { Button } from './Button';
import { DialogContent, DialogFooter, DialogHeader } from './Dialog';
import { InlineNotice } from './InlineNotice';
import { useDialogFocus } from './useDialogFocus';
export interface ConfirmDialogProps {
  trigger?: ReactNode;
  title: ReactNode;
  description: ReactNode;
  label?: string;
  busyLabel?: string;
  onConfirm: () => void | Promise<void>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  variant?: 'danger' | 'primary';
  disabled?: boolean;
  children?: ReactNode | ((state: { busy: boolean }) => ReactNode);
  dismissOnOutside?: boolean;
  className?: string;
  overlayClassName?: string;
  onCloseAutoFocus?: ComponentPropsWithoutRef<typeof Dialog.Content>['onCloseAutoFocus'];
}
export function ConfirmDialog({
  trigger,
  title,
  description,
  label = 'Delete',
  busyLabel = 'Deleting…',
  onConfirm,
  open: controlledOpen,
  onOpenChange,
  variant = 'danger',
  disabled = false,
  children,
  dismissOnOutside = true,
  className,
  overlayClassName,
  onCloseAutoFocus,
}: ConfirmDialogProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [error, setError] = useState('');
  const focus = useDialogFocus();
  function setOpen(value: boolean) {
    setLocalOpen(value);
    onOpenChange?.(value);
  }
  async function confirm() {
    if (sending.current || disabled) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      setOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open={controlledOpen ?? localOpen}
      onOpenChange={(value) => {
        if (!sending.current) {
          setOpen(value);
          setError('');
        }
      }}
    >
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <DialogContent
        {...focus}
        onCloseAutoFocus={onCloseAutoFocus ?? focus.onCloseAutoFocus}
        className={className}
        overlayClassName={overlayClassName}
        onEscapeKeyDown={(event) => {
          if (sending.current) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (sending.current || !dismissOnOutside) event.preventDefault();
        }}
      >
        <DialogHeader title={title} description={description} />
        {typeof children === 'function' ? children({ busy }) : children}
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
        <DialogFooter>
          <Dialog.Close asChild>
            <Button type="button" variant="outline" disabled={busy}>
              Cancel
            </Button>
          </Dialog.Close>
          <Button
            type="button"
            variant={variant}
            disabled={busy || disabled}
            loading={busy}
            loadingLabel={busyLabel}
            onClick={() => void confirm()}
          >
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}
