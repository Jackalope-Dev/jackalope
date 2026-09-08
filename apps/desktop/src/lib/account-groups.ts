import type { AgentProfile } from './agent-profiles';

export function accountGroupChoices(
  entries: { agent: string; profiles: AgentProfile[] }[],
  group: 'work' | 'personal',
) {
  const assignments: Record<string, string> = {};
  const ambiguous: string[] = [];
  const missing: string[] = [];
  for (const entry of entries) {
    const profiles = entry.profiles.filter((profile) => profile.group === group);
    if (profiles.length === 1) assignments[entry.agent] = profiles[0].id;
    else if (profiles.length > 1) ambiguous.push(entry.agent);
    else missing.push(entry.agent);
  }
  return { assignments, ambiguous, missing };
}
