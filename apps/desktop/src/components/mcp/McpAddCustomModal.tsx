import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import type { McpServerConfig } from '../../lib/tauri-bridge';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';
import { useDialogFocus } from '../ui/useDialogFocus';
import { McpConnectionForm } from './McpConnectionForm';
import { McpConnectionResult, type SavedMcpConnection } from './McpConnectionResult';
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
  const [saved, setSaved] = useState<SavedMcpConnection | null>(null);
  const [lastSaved, setLastSaved] = useState<SavedMcpConnection | null>(null);
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
        {saved ? (
          <McpConnectionResult saved={saved} onDone={onClose} onEdit={() => setSaved(null)} />
        ) : (
          <McpConnectionForm
            initial={lastSaved?.server ?? existingServer ?? undefined}
            initialAuthentication={lastSaved?.agentSignIn ? 'oauth' : undefined}
            editing={!!existingServer || !!lastSaved}
            onCancel={onClose}
            onSaved={(result) => {
              setSaved(result);
              setLastSaved(result);
            }}
            onBusyChange={setBusy}
          />
        )}
      </DialogContent>
    </Dialog.Root>
  );
}
