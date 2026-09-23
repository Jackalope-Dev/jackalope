import * as Dialog from '@radix-ui/react-dialog';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';
import { FeedbackForm } from './FeedbackForm';
import './settings.css';

export function FeedbackDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogCloseButton label="Close feedback" />
        <DialogHeader
          title="Send feedback"
          description={<>Report a bug, request a feature or share an idea.</>}
        />
        <FeedbackForm showHeading={false} />
      </DialogContent>
    </Dialog.Root>
  );
}
