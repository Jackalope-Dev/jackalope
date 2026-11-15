import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  InlineNotice,
  LoadingState,
} from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { invokeNative } from '../../lib/native/transport';
import { type PairingCode, PairingView } from './PairingCode';

/** What a host returns for `invitePhone`: a one-time code, or that it has no HTTPS address. */
type Invite = (PairingCode & { computer?: string }) | { needsHttps: true; computer?: string };

function originOf(link: string | null) {
  try {
    return link ? new URL(link).origin : '';
  } catch {
    return '';
  }
}

/**
 * Asks a paired host for a one-time phone pairing code and shows it here, so the phone pairs
 * with that host directly over its HTTPS address. Nothing is relayed through this computer,
 * and the host allows it only when its owner turned on invitations from paired computers.
 */
export function InvitePhone({ hostId, name }: { hostId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [expires, setExpires] = useState(0);
  const [error, setError] = useState('');
  const request = async () => {
    setOpen(true);
    setBusy(true);
    setError('');
    setInvite(null);
    try {
      const reply = await invokeNative<Invite>('remote_host_invite_phone', { id: hostId });
      setInvite(reply);
      if ('code' in reply) setExpires(Date.now() + reply.expiresIn * 1000);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };
  const computer = invite?.computer || name;
  return (
    <>
      <Button size="sm" disabled={busy} onClick={() => void request()}>
        Show a phone code for {name}
      </Button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <DialogContent className="remote-invite-dialog" aria-describedby={undefined}>
          <DialogHeader title={`Pair your phone with ${computer}`} />
          <DialogCloseButton />
          {busy && <LoadingState label={`Asking ${name} for a code…`} />}
          {error && (
            <InlineNotice tone="error">
              {error} You can also pair on {name} itself: Devices → Let devices use this one → Pair
              a phone.
            </InlineNotice>
          )}
          {invite && 'needsHttps' in invite && (
            <InlineNotice tone="warning">
              {computer} has no HTTPS address yet, and phones only connect over HTTPS. On {computer}
              , open Devices → Let devices use this one and follow the Tailscale steps, then try
              again.
            </InlineNotice>
          )}
          {invite && 'code' in invite && (
            <PairingView
              pair={invite}
              expires={expires}
              origin={originOf(invite.link)}
              scanHint={`Scan this with the Jackalope app. Your phone pairs with ${computer} directly, so it keeps working while this computer is off.`}
            />
          )}
        </DialogContent>
      </Dialog.Root>
    </>
  );
}
