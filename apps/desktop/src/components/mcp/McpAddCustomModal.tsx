import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState } from 'react';
import type { McpServerConfig } from '../../lib/tauri-bridge';
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
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content {...focus} className="task-dialog appearance-panel mcp-connection-dialog">
          <Dialog.Close disabled={busy} className="task-close" aria-label="Close dialog">
            <X size={18} />
          </Dialog.Close>
          <Dialog.Title className="text-xl font-medium">
            {existingServer ? 'Edit connection' : 'Add connection'}
          </Dialog.Title>
          <Dialog.Description className="task-muted mt-2 mb-6">
            Connect a local command or remote MCP server, then choose where it is available.
          </Dialog.Description>
          <McpConnectionForm
            initial={existingServer ?? undefined}
            editing={!!existingServer}
            onCancel={onClose}
            onSaved={onClose}
            onBusyChange={setBusy}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
