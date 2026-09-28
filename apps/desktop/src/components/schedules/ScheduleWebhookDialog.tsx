import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';
import { FormField } from '../ui/FormField';
import { InlineNotice } from '../ui/InlineNotice';
import { Input } from '../ui/input';
import { useDialogFocus } from '../ui/useDialogFocus';

export interface WebhookState {
  id: string;
  name: string;
  active: boolean;
  url?: string;
  token?: string;
}

export function ScheduleWebhookDialog({
  webhook,
  busy,
  error,
  onClose,
  onEnable,
  onDisable,
}: {
  webhook: WebhookState | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onEnable: () => Promise<void>;
  onDisable: () => Promise<void>;
}) {
  const focus = useDialogFocus();

  return (
    <Dialog.Root
      open={!!webhook}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent {...focus}>
        <DialogCloseButton label="Close webhook" />
        <DialogHeader
          title={webhook ? `Webhook for ${webhook.name}` : 'Webhook'}
          description="This app receives the request on this computer. The token is shown once. A call while the previous run is still active is skipped and is not queued."
        />
        {webhook?.token && webhook.url ? (
          <div className="workspace-stack">
            <FormField label="Address">
              <Input readOnly value={webhook.url} />
            </FormField>
            <FormField label="Token">
              <Input readOnly value={webhook.token} />
            </FormField>
            <p className="task-muted">
              Send POST with header Authorization: Bearer and this token. It will not be shown
              again.
            </p>
          </div>
        ) : (
          <p className="task-muted">
            {webhook?.active
              ? 'A webhook is already active. Replacing it creates a new token and the previous one stops working.'
              : 'Create a link that runs this schedule when something on this computer calls it.'}
          </p>
        )}
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
        <div className="flex flex-wrap gap-2">
          {webhook?.token ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <Button disabled={busy || !webhook} onClick={() => void onEnable()}>
              {webhook?.active ? 'Replace token' : 'Create link'}
            </Button>
          )}
          {webhook?.active && !webhook?.token && (
            <Button variant="outline" disabled={busy} onClick={() => void onDisable()}>
              Remove webhook
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog.Root>
  );
}
