import { isDone } from '@jackalope/contracts/runs';
import { Button, IconButton, Tooltip } from '@jackalope/ui';
import { UserRound, X } from 'lucide-react';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ACCOUNT_BENEFITS, accountAccess, suggestionDue } from '../../lib/account';
import { openSettings } from '../../lib/app-events';
import { useAccountPromptStore, useAccountStore } from '../../stores/accountStore';
import { useExecutionStore } from '../../stores/executionStore';
import './account-prompts.css';

/** A quiet sidebar entry to Settings → Jackalope account while no account is connected. */
export function ConnectAccountEntry() {
  const access = useAccountStore((state) => accountAccess(state.status));
  if (access !== 'none') return null;
  return (
    <Tooltip side="right" content="Connect a free Jackalope account">
      <button
        type="button"
        className="workspace-nav-item workspace-account"
        aria-label="Connect account"
        onClick={() => openSettings('Jackalope account')}
      >
        <UserRound aria-hidden="true" />
        <span>Connect account</span>
      </button>
    </Tooltip>
  );
}

/**
 * The one suggestion to connect, offered after the first finished task or on
 * a second day of use. "Not now" brings it back once a week later; closing it
 * or a second "Not now" retires it for good.
 */
export function AccountSuggestion() {
  const access = useAccountStore((state) => accountAccess(state.status));
  const connecting = useAccountStore((state) => state.connecting);
  const error = useAccountStore((state) => state.error);
  const finished = useExecutionStore((state) => state.runs.some((run) => isDone(run.status)));
  const prompts = useAccountPromptStore(
    useShallow((state) => ({
      suggestion: state.suggestion,
      snoozedUntil: state.snoozedUntil,
      shownThisLaunch: state.shownThisLaunch,
      returned: state.returned,
    })),
  );
  const due = access === 'none' && suggestionDue(prompts, finished || prompts.returned, Date.now());
  useEffect(() => {
    if (due) useAccountPromptStore.getState().markShown();
  }, [due]);
  if (!due) return null;
  return (
    <section className="account-suggestion" aria-labelledby="account-suggestion-text">
      <UserRound size={18} aria-hidden="true" />
      <div className="account-suggestion-text">
        <p id="account-suggestion-text">{ACCOUNT_BENEFITS}</p>
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="account-suggestion-actions">
        <Button
          variant="outline"
          size="sm"
          loading={connecting}
          loadingLabel="Connecting…"
          onClick={async () => {
            await useAccountStore.getState().connect();
            if (!useAccountStore.getState().error) useAccountPromptStore.getState().dismiss();
          }}
        >
          Connect account
        </Button>
        <Button variant="ghost" size="sm" onClick={() => useAccountPromptStore.getState().snooze()}>
          Not now
        </Button>
        <IconButton
          label="Don’t suggest this again"
          onClick={() => useAccountPromptStore.getState().dismiss()}
        >
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>
    </section>
  );
}
