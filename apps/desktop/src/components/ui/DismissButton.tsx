import { X } from 'lucide-react';
import { Button } from './button';

/** Close control for a notice the user can clear, placed in InlineNotice's action slot. */
export function DismissButton({
  onDismiss,
  label = 'Dismiss',
}: {
  onDismiss: () => void;
  label?: string;
}) {
  return (
    <Button type="button" variant="ghost" size="icon" aria-label={label} onClick={onDismiss}>
      <X size={16} aria-hidden="true" />
    </Button>
  );
}
