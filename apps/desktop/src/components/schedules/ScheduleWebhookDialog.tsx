import {
  Button,
  CopyButton,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  FlowDiagram,
  FormField,
  Input,
  SetupSteps,
  useDialogFocus,
} from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { CalendarClock, Webhook } from 'lucide-react';
import { ActionError } from '../ui/ActionError';

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
  const issued = Boolean(webhook?.token && webhook.url);
  const example =
    issued && webhook?.url && webhook.token
      ? `curl -X POST -H "Authorization: Bearer ${webhook.token}" ${webhook.url}`
      : '';

  return (
    <Dialog.Root
      open={!!webhook}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent {...focus} className="schedule-webhook">
        <DialogCloseButton label="Close webhook" />
        <DialogHeader
          title={webhook ? `Webhook for ${webhook.name}` : 'Webhook'}
          description="Run this schedule when a script or tool on this computer calls a link. A call while the previous run is still active is skipped, not queued."
        />
        <FlowDiagram
          from={{ label: 'Your script or tool', icon: <Webhook size={16} /> }}
          to={{ label: webhook?.name ?? 'Schedule', icon: <CalendarClock size={16} /> }}
          via="POST"
          state={webhook?.active || issued ? 'connected' : 'idle'}
        />
        <SetupSteps
          label="Set up a webhook"
          steps={[
            {
              id: 'create',
              title: webhook?.active && !issued ? 'Replace the token' : 'Create the link',
              hint:
                webhook?.active && !issued
                  ? 'A webhook is active. A new token stops the previous one working.'
                  : 'Jackalope makes a local address and a secret token for this schedule.',
              state: issued ? 'done' : 'current',
              summary: issued ? 'Link and token created' : undefined,
              content: (
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy || !webhook} onClick={() => void onEnable()}>
                    {webhook?.active ? 'Replace token' : 'Create link'}
                  </Button>
                  {webhook?.active && (
                    <Button variant="outline" disabled={busy} onClick={() => void onDisable()}>
                      Remove webhook
                    </Button>
                  )}
                </div>
              ),
            },
            {
              id: 'copy',
              title: 'Copy the address and token',
              hint: 'The token is shown only now. Store it where your script can read it.',
              state: issued ? 'current' : 'upcoming',
              content: issued && webhook?.url && webhook.token && (
                <div className="schedule-webhook-values">
                  <FormField label="Address">
                    <Input readOnly value={webhook.url} />
                  </FormField>
                  <CopyButton size="sm" variant="outline" text={webhook.url} label="Copy address" />
                  <FormField label="Token">
                    <Input readOnly value={webhook.token} />
                  </FormField>
                  <CopyButton size="sm" variant="outline" text={webhook.token} label="Copy token" />
                </div>
              ),
            },
            {
              id: 'call',
              title: 'Call it',
              hint: 'Send POST with the header Authorization: Bearer and the token.',
              state: issued ? 'current' : 'upcoming',
              content: issued && (
                <div className="schedule-webhook-example">
                  <code>{example}</code>
                  <CopyButton size="sm" variant="outline" text={example} label="Copy command" />
                </div>
              ),
            },
          ]}
        />
        <ActionError error={error} />
        {issued && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={onClose}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog.Root>
  );
}
