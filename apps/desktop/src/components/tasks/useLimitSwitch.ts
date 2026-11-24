import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getAgentMetadata } from '../../lib/agent-catalog';
import { observedLimits, type UsageLimit } from '../../lib/usage-limit';
import { accountProfiles, profileId, useAgentAccountsStore } from '../../stores/agentAccountsStore';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import type { Project } from '../../stores/projectStore';
import { useComposerAgents } from '../sessions/ComposerAgentPicker';
import type { LimitSwitchOption } from './UsageLimitBanner';

/**
 * Where work a usage limit stopped can move: other accounts of the same agent that this
 * project allows and that are not signed out, and other agents this project can run on
 * their default account. Accounts recent work found limited are left out. The native
 * retry still checks project policy before anything starts.
 */
export function useLimitSwitchOptions(
  limit: UsageLimit | null,
  project: Project | undefined,
): { accounts: LimitSwitchOption[]; agents: LimitSwitchOption[] } {
  const agent = limit?.agent;
  const roster = useComposerAgents(project);
  const runs = useExecutionStore((state) => state.runs);
  const disabledAccounts = useAgentConfigStore((state) => state.disabledAccounts);
  const { entry, load } = useAgentAccountsStore(
    useShallow((state) => ({ entry: agent ? state.agents[agent] : undefined, load: state.load })),
  );
  useEffect(() => {
    if (agent) void load(agent);
  }, [agent, load]);
  return useMemo(() => {
    if (!limit) return { accounts: [], agents: [] };
    const now = Date.now();
    const limited = observedLimits(runs, now);
    const isLimited = (agentId: string, profile: string | null) =>
      limited.some((item) => item.agent === agentId && item.profileId === profile);
    const pinned = project?.preferences?.agentAccounts?.[limit.agent];
    const accounts = entry?.view
      ? accountProfiles(entry.view, entry.statuses)
          .filter(
            (account) =>
              profileId(account.id) !== limit.profileId &&
              !disabledAccounts[limit.agent]?.includes(account.id) &&
              !project?.preferences?.disabledAccounts?.[limit.agent]?.includes(account.id) &&
              (!pinned || pinned === account.id) &&
              entry.statuses[account.id]?.state !== 'signedOut' &&
              !isLimited(limit.agent, profileId(account.id)),
          )
          .map((account) => ({
            id: `account:${account.id}`,
            label: account.name,
            agent: limit.agent,
            profileId: profileId(account.id),
          }))
      : [];
    const agents = roster
      .filter((runner) => runner.adapter !== limit.agent && runner.id !== limit.agent)
      .map((runner) => {
        const account = project?.preferences?.agentAccounts?.[runner.id];
        return {
          id: `agent:${runner.id}`,
          label: getAgentMetadata(runner.id)?.name ?? runner.name,
          agent: runner.id,
          profileId: account ? profileId(account) : null,
          adapter: runner.adapter,
        };
      })
      .filter((option) => !isLimited(option.adapter, option.profileId))
      .map(({ adapter: _adapter, ...option }) => option);
    return { accounts, agents };
  }, [limit, project, roster, runs, entry, disabledAccounts]);
}
