import { useEffect, useState } from 'react';
import { listAgentProfiles } from '../../lib/agent-profiles';
import { Select, SelectItem } from '../ui/Select';

export function ProjectAgentAccount({
  agentId,
  agentName,
  projectName,
  value,
  onChange,
}: {
  agentId: string;
  agentName: string;
  projectName: string;
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    listAgentProfiles(agentId)
      .then((view) => {
        if (!cancelled) setProfiles(view.profiles);
      })
      .catch(() => {
        if (!cancelled) setProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  if (profiles.length === 0) return null;

  return (
    <div className="project-agent-account">
      <span className="task-muted text-xs">
        {agentName} account for {projectName}
      </span>
      <Select
        aria-label={`${agentName} account for ${projectName}`}
        value={value ?? 'inherit'}
        onValueChange={(next) => onChange(next === 'inherit' ? undefined : next)}
      >
        <SelectItem value="inherit">Whichever account is active</SelectItem>
        {profiles.map((profile) => (
          <SelectItem key={profile.id} value={profile.id}>
            {profile.name}
          </SelectItem>
        ))}
      </Select>
    </div>
  );
}
