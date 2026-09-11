import { useState } from 'react';
import { sessionCommand } from '../../lib/live-session';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

export function SessionRecovery() {
  const { error, refresh } = useLiveSessionStore();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  if (!error) return null;
  return (
    <InlineNotice tone="error">
      {failure || error}
      <Button
        variant="outline"
        loading={busy}
        loadingLabel="Reloading…"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailure('');
          try {
            await sessionCommand('recover');
            await refresh();
          } catch (cause) {
            setFailure(String(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        Reload saved sessions
      </Button>
    </InlineNotice>
  );
}
