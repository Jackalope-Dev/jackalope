import { ConfirmDialog, type ConfirmDialogProps } from '@jackalope/ui';

export function ConfirmAction(props: ConfirmDialogProps) {
  return (
    <ConfirmDialog
      overlayClassName="confirm-action-overlay"
      className="confirm-action-dialog"
      {...props}
    />
  );
}
