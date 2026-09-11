import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import type { McpServerConfig } from '../../lib/tauri-bridge';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';
import { useDialogFocus } from '../ui/useDialogFocus';
import { McpConnectionForm } from './McpConnectionForm';
export function McpAddCustomModal({
  open,
  onClose,
  existingServer,
}: {
  open: boolean;
  onClose: () => void;
  existingServer?: McpServerConfig | null;
}) {
  const [busy, setBusy] = useState(false);
  const focus = useDialogFocus();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent {...focus} className="mcp-connection-dialog">
        <DialogCloseButton disabled={busy} label="Close dialog" />
        <DialogHeader
          title={existingServer ? 'Edit connection' : 'Add connection'}
          description={
            <>Connect a local command or remote MCP server, then choose where it is available.</>
          }
        />
        <McpConnectionForm
          initial={existingServer ?? undefined}
          editing={!!existingServer}
          onCancel={onClose}
          onSaved={onClose}
          onBusyChange={setBusy}
        />
      </DialogContent>
    </Dialog.Root>
  );
}
