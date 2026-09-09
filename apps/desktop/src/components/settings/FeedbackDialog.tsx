import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { returnToCompanion } from '../mascot/useCompanionNotices';
import { FeedbackForm } from './FeedbackForm';
import './settings.css';

export function FeedbackDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content
          className="task-dialog appearance-panel"
          onCloseAutoFocus={returnToCompanion}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <Dialog.Close className="task-close" aria-label="Close feedback">
            <X size={18} />
          </Dialog.Close>
          <Dialog.Title className="text-xl font-medium pr-10">Send feedback</Dialog.Title>
          <Dialog.Description className="task-muted mt-3 mb-6">
            Report a bug, request a feature or share an idea.
          </Dialog.Description>
          <FeedbackForm showHeading={false} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
