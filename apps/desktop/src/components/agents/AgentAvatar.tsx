import { AgentCharacter } from '@jackalope/brand/agent-character';
import { agentProvider } from '../../lib/agent-provider';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import './agent-avatar.css';

export function AgentAvatar({
  provider,
  working = false,
  waiting = false,
  size = 'lg',
}: {
  provider: string;
  working?: boolean;
  waiting?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}) {
  return (
    <span className="agent-avatar" data-provider={provider} data-size={size} aria-hidden="true">
      <AgentCharacter
        provider={agentProvider(provider)}
        state={waiting ? 'waiting' : working ? 'working' : 'idle'}
      />
    </span>
  );
}

export function AgentStack({
  agents,
  state = 'idle',
  size = 'sm',
}: {
  agents: string[];
  state?: 'idle' | 'working' | 'waiting';
  size?: 'xs' | 'sm' | 'md' | 'lg';
}) {
  const custom = useAgentConfigStore((store) => store.customAgents);
  const shown = agents.slice(0, 3);
  if (!shown.length) return null;
  return (
    <span className="agent-stack" aria-hidden="true">
      {shown.map((agent) => (
        <AgentAvatar
          key={agent}
          provider={agentProvider(agent, custom.find((item) => item.id === agent)?.adapter)}
          working={state === 'working'}
          waiting={state === 'waiting'}
          size={size}
        />
      ))}
    </span>
  );
}
