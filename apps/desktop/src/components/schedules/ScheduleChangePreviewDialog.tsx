import * as Dialog from '@radix-ui/react-dialog';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';
import { Textarea } from '../ui/Textarea';
import { useDialogFocus } from '../ui/useDialogFocus';

export interface ChangePreviewData {
  title: string;
  text: string;
}

export function ScheduleChangePreviewDialog({
  preview,
  onClose,
}: {
  preview: ChangePreviewData | null;
  onClose: () => void;
}) {
  const focus = useDialogFocus();

  return (
    <Dialog.Root
      open={!!preview}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent {...focus}>
        <DialogCloseButton label="Close change preview" />
        <DialogHeader
          title={preview?.title}
          description={
            <>
              Local content difference captured by this monitor. No agent was used to produce this
              preview.
            </>
          }
        />
        <Textarea
          className="task-output mt-4 w-full"
          aria-label="Recorded content diff"
          readOnly
          rows={14}
          value={preview?.text || 'No text diff available.'}
        />
      </DialogContent>
    </Dialog.Root>
  );
}
