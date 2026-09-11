import { PassTickets } from '@jackalope/brand/passes';
import { Button, CopyButton, IconButton, Input, MailIcon } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, Check, X } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { accessMessage, accessRequest } from './access-api';
import { BrandMark } from './BrandMark';

interface Allowance {
  limit: number;
  remaining: number;
  accepted: number;
}

export function AccessPasses({
  member,
  onSent,
}: {
  member: Allowance & { shareUrl: string };
  onSent: (updated: Allowance) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const trigger = useRef<HTMLButtonElement | null>(null);
  const available = member.remaining > 0;
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !available) return;
    const form = event.currentTarget;
    const email = String(new FormData(form).get('email') || '').trim();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await accessRequest<Allowance>('invites', { emails: [email] });
      onSent(updated);
      form.reset();
      setNotice(`Invitation requested for ${email}. Check its delivery status below.`);
    } catch (cause) {
      setError(accessMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open={selected !== null}
      onOpenChange={(open) => {
        if (!open) setSelected(null);
      }}
    >
      <PassTickets
        {...member}
        disabled={busy}
        onSelect={(number, button) => {
          trigger.current = button;
          setSelected(number);
          setError('');
          setNotice('');
        }}
      />
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="release-dialog pass-dialog"
          aria-describedby="pass-dialog-description"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (trigger.current && !trigger.current.disabled) trigger.current.focus();
            else document.getElementById('invite-heading')?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <Dialog.Close asChild>
            <IconButton
              className="icon-button dialog-close"
              label="Close share pass"
              disabled={busy}
            >
              <X size={20} />
            </IconButton>
          </Dialog.Close>
          <BrandMark className="dialog-mark" />
          <Dialog.Title>Give someone a head start.</Dialog.Title>
          <Dialog.Description id="pass-dialog-description">
            Share an Instant Access Pass to Jackalope. They can skip the waitlist after verifying
            their email.
          </Dialog.Description>
          <div className="pass-dialog-link">
            <CopyButton
              variant="primary"
              className="button button-primary"
              text={member.shareUrl}
              label="Copy share link"
              copiedLabel="Pass link copied"
              disabled={busy || !available}
              errorMessage="Couldn’t copy automatically. Select and copy the link below."
            />
            <label htmlFor="pass-dialog-url">Your shared pass link</label>
            <Input
              id="pass-dialog-url"
              readOnly
              value={member.shareUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
            <p>Uses one of your available passes when claimed.</p>
          </div>
          <form onSubmit={send}>
            <label htmlFor="pass-dialog-email">
              <MailIcon size={16} /> Or send by email
            </label>
            <p>Reserve a place for seven days.</p>
            <Input
              id="pass-dialog-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="friend@example.com"
              required
              maxLength={254}
              disabled={busy || !available}
            />
            <Button
              variant="secondary"
              className="button button-secondary"
              type="submit"
              disabled={busy || !available}
              loading={busy}
              loadingLabel={'Sending…'}
            >
              {'Send a pass'}
              <ArrowRight size={17} />
            </Button>
          </form>
          {!available && <p>No passes are available right now.</p>}
          {notice && (
            <p className="pass-dialog-notice" role="status">
              <Check size={18} />
              {notice}
            </p>
          )}
          {error && (
            <p className="access-alert" role="alert">
              {error}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
