import { Paperclip } from 'lucide-react';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/Tooltip';

/** Opens the file picker for a composer that uses `usePromptAttachments`. */
export function AttachButton({
  onPick,
  disabled,
  busy,
}: {
  onPick: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Tooltip content="Attach files. You can also paste an image or drop files here.">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Attach files"
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        onClick={onPick}
      >
        <Paperclip size={18} aria-hidden="true" />
      </Button>
    </Tooltip>
  );
}
