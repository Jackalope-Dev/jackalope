import { Check, Circle, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  type AgentProfile,
  createAgentProfile,
  deleteAgentProfile,
  listAgentProfiles,
  renameAgentProfile,
  setActiveAgentProfile,
  signInAgentProfile,
} from '../../lib/agent-profiles';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { Button } from '../ui/button';
import { ConfirmAction } from '../ui/ConfirmAction';

export function AgentAccounts({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [envVar, setEnvVar] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const desktop = isTauriEnvironment();

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const view = await listAgentProfiles(agentId);
      setProfiles(view.profiles);
      setActiveId(view.activeId);
      setEnvVar(view.envVar);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is recreated each render but only reads agentId, already listed
  useEffect(() => {
    if (desktop) void load();
  }, [agentId, desktop]);

  const add = async () => {
    if (!name.trim()) return;
    setBusy('add');
    setError('');
    try {
      await createAgentProfile(agentId, name.trim());
      setName('');
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy('');
    }
  };

  if (desktop && !envVar && (loading || error)) {
    return error ? (
      <div className="space-y-3">
        <p role="alert" className="task-error">
          {error}
        </p>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          Retry accounts
        </Button>
      </div>
    ) : (
      <p role="status" className="task-muted">
        Loading accounts…
      </p>
    );
  }
  if (!desktop || !envVar) {
    return (
      <p className="task-muted">
        {desktop
          ? agentId === 'antigravity'
            ? 'Antigravity uses your current agy CLI sign-in. Sign in by running agy in a terminal. Separate Jackalope accounts are unavailable; changing the CLI account also affects task continuations.'
            : `Jackalope does not have a known way to isolate ${agentName}'s sign-in, so separate accounts aren't available for it.`
          : 'Accounts are available in the desktop app.'}
      </p>
    );
  }

  return (
    <div className="agent-accounts">
      <p className="task-muted">
        Give {agentName} more than one sign-in — for example a work account and a personal one — and
        switch which one Jackalope tasks use. Signing in opens {agentName}'s own login in a separate
        window; each account keeps its own credentials, untouched by the others.
      </p>
      {error && (
        <p role="alert" className="task-error">
          {error}
        </p>
      )}
      <Button
        variant="outline"
        disabled={!!busy || !activeId}
        onClick={async () => {
          setBusy('default');
          setError('');
          try {
            await setActiveAgentProfile(agentId, null);
            await load();
          } catch (error) {
            setError(String(error));
          } finally {
            setBusy('');
          }
        }}
      >
        {activeId ? 'Use normal CLI sign-in' : 'Using normal CLI sign-in'}
      </Button>
      {loading && !profiles.length ? (
        <p className="task-muted text-sm">Loading accounts…</p>
      ) : profiles.length === 0 ? (
        <p className="task-muted text-sm">
          No accounts added yet. {agentName} uses its normal, single sign-in until you add one.
        </p>
      ) : (
        <ul className="agent-accounts-list">
          {profiles.map((profile) => (
            <li key={profile.id} className="agent-accounts-row">
              <button
                type="button"
                className="agent-account-select"
                aria-pressed={profile.id === activeId}
                aria-label={`Use ${profile.name}`}
                disabled={!!busy}
                onClick={async () => {
                  setBusy(profile.id);
                  setError('');
                  try {
                    await setActiveAgentProfile(agentId, profile.id);
                    await load();
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy('');
                  }
                }}
              >
                {profile.id === activeId ? <Check size={16} /> : <Circle size={16} />}
              </button>
              <input
                className="task-input min-w-0 flex-1"
                value={draftNames[profile.id] ?? profile.name}
                disabled={!!busy}
                onChange={(e) =>
                  setDraftNames((drafts) => ({ ...drafts, [profile.id]: e.target.value }))
                }
                onBlur={async (e) => {
                  const value = e.target.value.trim();
                  if (!value) {
                    setError('Account names cannot be empty.');
                    return;
                  }
                  if (value === profile.name) return;
                  setBusy(profile.id);
                  setError('');
                  try {
                    await renameAgentProfile(agentId, profile.id, value);
                    setProfiles((profiles) =>
                      profiles.map((item) =>
                        item.id === profile.id ? { ...item, name: value } : item,
                      ),
                    );
                    setDraftNames((drafts) => ({ ...drafts, [profile.id]: value }));
                  } catch (err) {
                    setError(String(err));
                  } finally {
                    setBusy('');
                  }
                }}
                aria-label={`Account name for ${profile.name}`}
              />
              <div className="agent-accounts-actions">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy(profile.id);
                    setError('');
                    try {
                      await signInAgentProfile(agentId, profile.id);
                    } catch (e) {
                      setError(String(e));
                    } finally {
                      setBusy('');
                    }
                  }}
                >
                  <ExternalLink size={14} />
                  Sign in
                </Button>
                <ConfirmAction
                  title="Remove account?"
                  description={`Remove ${profile.name} and its Jackalope sign-in data? The CLI's normal sign-in is kept.`}
                  label="Remove account"
                  onConfirm={async () => {
                    setBusy(profile.id);
                    try {
                      await deleteAgentProfile(agentId, profile.id);
                      await load();
                    } finally {
                      setBusy('');
                    }
                  }}
                  trigger={
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Remove ${profile.name}`}
                      disabled={!!busy}
                    >
                      <Trash2 size={14} />
                    </Button>
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          className="task-input flex-1 min-w-0"
          disabled={!!busy}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`e.g. "Work" or "Personal"`}
          aria-label={`New ${agentName} account name`}
        />
        <Button type="submit" variant="outline" disabled={!name.trim() || !!busy}>
          <Plus size={15} />
          Add account
        </Button>
      </form>
    </div>
  );
}
