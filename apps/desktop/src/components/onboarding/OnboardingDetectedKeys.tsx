import { Button, InlineNotice } from '@jackalope/ui';
import { useEffect, useState } from 'react';
import { type DetectedKey, detectEnvKeys, importDetectedKey } from '../../lib/local-detection';
import { accountProfiles, useAgentAccountsStore } from '../../stores/agentAccountsStore';

/**
 * Offers API keys found in the environment for installed agents that have no working
 * account yet. Nothing is imported until the person chooses a key.
 */
export function OnboardingDetectedKeys({
  agents,
  disabled,
  onUse,
}: {
  agents: { adapter: string; name: string }[];
  disabled: boolean;
  onUse: (adapter: string, profileId: string) => void;
}) {
  const [keys, setKeys] = useState<DetectedKey[]>([]);
  const [importing, setImporting] = useState('');
  const [error, setError] = useState('');
  const accounts = useAgentAccountsStore((state) => state.agents);
  useEffect(() => {
    void detectEnvKeys()
      .then(setKeys)
      .catch(() => {});
  }, []);
  const needsAccount = (adapter: string) => {
    const entry = accounts[adapter];
    if (!entry?.view) return false;
    const statuses = accountProfiles(entry.view, entry.statuses).map(
      (account) => entry.statuses[account.id],
    );
    // Wait for every check so a signed-in account never sits beside a key offer.
    return (
      statuses.every(Boolean) &&
      !statuses.some((status) => status?.state === 'signedIn' || status?.state === 'configured')
    );
  };
  const offers = keys.flatMap((key) => {
    const agent = agents.find((item) => item.adapter === key.targetAgent);
    return agent && !key.isConfigured && needsAccount(agent.adapter) ? [{ key, agent }] : [];
  });
  if (!offers.length && !error) return null;
  return (
    <div className="onboarding-detected-keys">
      {offers.map(({ key, agent }) => (
        <InlineNotice
          key={key.keyName}
          action={
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || !!importing}
              loading={importing === key.keyName}
              loadingLabel="Adding key…"
              onClick={async () => {
                setImporting(key.keyName);
                setError('');
                try {
                  const profile = await importDetectedKey(key.keyName);
                  setKeys((current) => current.filter((item) => item.keyName !== key.keyName));
                  await useAgentAccountsStore.getState().load(agent.adapter, true);
                  onUse(agent.adapter, profile.id);
                } catch (cause) {
                  setError(String(cause));
                } finally {
                  setImporting('');
                }
              }}
            >
              Use key
            </Button>
          }
        >
          Found {key.keyName} ({key.maskedPreview}). Use it for {agent.name}?
        </InlineNotice>
      ))}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </div>
  );
}
