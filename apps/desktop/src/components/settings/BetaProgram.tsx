import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { Button } from '../ui/button';
import { FormField } from '../ui/FormField';
import { InlineNotice } from '../ui/InlineNotice';
import { Input } from '../ui/input';

interface BetaRequest {
  kind: 'join' | 'leave';
  storeEmail: string;
  status: 'pending' | 'done' | 'declined';
  createdAt: number;
  resolvedAt: number | null;
}
type BetaAction =
  | { action: 'status' }
  | { action: 'request'; kind: BetaRequest['kind']; storeEmail: string }
  | { action: 'withdraw' };

const day = (time: number) =>
  new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * Store builds can't switch channels themselves: Microsoft delivers beta
 * builds only to Store accounts the operator adds to the flight, so this asks
 * for that and reports the request's progress.
 */
export function BetaProgram({ onBeta }: { onBeta: boolean }) {
  const [request, setRequest] = useState<BetaRequest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const run = useCallback(async (action: BetaAction) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const view = await nativeTask<{ request: BetaRequest | null }>('app_account_beta', {
        action,
      });
      setRequest(view.request);
      setLoaded(true);
    } catch (cause) {
      setError(String(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void run({ action: 'status' });
  }, [run]);

  const wanted = onBeta ? 'leave' : 'join';
  const pending = request?.status === 'pending' ? request : null;
  // A finished request that hasn't reached this install yet: the Store
  // delivers the other channel's build with its next update.
  const awaitingStore = request?.status === 'done' && request.kind === wanted ? request : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run({ action: 'request', kind: wanted, storeEmail: email });
  };
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Beta program</p>
        <p className="settings-row-description">
          {onBeta
            ? 'You’re receiving beta builds through Microsoft Store. They include early changes that may be less stable.'
            : 'Get new features early through Microsoft Store. Beta builds may be less stable.'}
        </p>
      </div>
      {pending ? (
        <InlineNotice
          tone="info"
          action={
            <Button
              variant="outline"
              disabled={busy}
              loading={busy}
              loadingLabel="Withdrawing…"
              onClick={() => void run({ action: 'withdraw' })}
            >
              Withdraw
            </Button>
          }
        >
          {pending.kind === 'join' ? 'Beta request' : 'Request to leave beta'} sent{' '}
          {day(pending.createdAt)} for {pending.storeEmail}. Updates arrive through Microsoft Store
          once it’s processed.
        </InlineNotice>
      ) : awaitingStore ? (
        <InlineNotice tone="success">
          {awaitingStore.kind === 'join'
            ? `Added to the beta on ${day(awaitingStore.resolvedAt ?? awaitingStore.createdAt)}. The next Microsoft Store update installs the beta build.`
            : `Removed from the beta on ${day(awaitingStore.resolvedAt ?? awaitingStore.createdAt)}. You’ll move to the next stable release when it’s newer than this beta.`}
        </InlineNotice>
      ) : (
        loaded && (
          <form className="space-y-3" onSubmit={submit}>
            {request?.status === 'declined' && request.kind === wanted && (
              <InlineNotice tone="warning">
                Your last request wasn’t accepted. You can send another.
              </InlineNotice>
            )}
            <FormField
              label="Microsoft account email"
              description="The account you’re signed in with in the Microsoft Store app. It can differ from your Jackalope email."
            >
              <Input
                className="settings-input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </FormField>
            <Button
              type="submit"
              variant="outline"
              disabled={busy || !email.trim()}
              loading={busy}
              loadingLabel="Sending…"
            >
              {onBeta ? 'Request to leave beta' : 'Request beta access'}
            </Button>
          </form>
        )
      )}
      {error && (
        <InlineNotice
          tone="error"
          action={
            !loaded && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void run({ action: 'status' })}
              >
                Retry
              </Button>
            )
          }
        >
          {error}
        </InlineNotice>
      )}
    </div>
  );
}
