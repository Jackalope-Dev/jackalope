import { agentProvider } from '../../lib/agent-provider';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { ProviderMark } from './ProviderMark';
import './agent-avatar.css';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

const MARK_SIZE: Record<AvatarSize, number> = { xs: 15, sm: 24, md: 28, lg: 42 };

/**
 * The provider's product mark for an agent working on a task, in a tile whose ring shows
 * whether it is working or waiting on the person. Bots keep their own characters (BotAvatar).
 */
export function AgentAvatar({
  provider,
  working = false,
  waiting = false,
  size = 'lg',
}: {
  provider: string;
  working?: boolean;
  waiting?: boolean;
  size?: AvatarSize;
}) {
  return (
    <span
      className="agent-avatar"
      data-provider={provider}
      data-size={size}
      data-state={waiting ? 'waiting' : working ? 'working' : 'idle'}
      aria-hidden="true"
    >
      <ProviderMark provider={provider} size={MARK_SIZE[size]} />
    </span>
  );
}

/** The agent that worked on a task most recently. Earlier agents stay in the task's details. */
export function LatestAgent({
  agents,
  state = 'idle',
  size = 'xs',
}: {
  agents: string[];
  state?: 'idle' | 'working' | 'waiting';
  size?: AvatarSize;
}) {
  const custom = useAgentConfigStore((store) => store.customAgents);
  const agent = agents[0];
  if (!agent) return null;
  return (
    <AgentAvatar
      provider={agentProvider(agent, custom.find((item) => item.id === agent)?.adapter)}
      working={state === 'working'}
      waiting={state === 'waiting'}
      size={size}
    />
  );
}

export function AgentStack({
  agents,
  state = 'idle',
  size = 'sm',
}: {
  agents: string[];
  state?: 'idle' | 'working' | 'waiting';
  size?: AvatarSize;
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
