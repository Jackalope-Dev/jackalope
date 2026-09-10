import { AgentCharacter } from '@jackalope/brand/agent-character';

export function AgentAvatar({
  provider,
  working,
  waiting,
}: {
  provider: string;
  working: boolean;
  waiting: boolean;
}) {
  return (
    <span className="agent-avatar" data-provider={provider} aria-hidden="true">
      <AgentCharacter
        provider={provider}
        state={waiting ? 'waiting' : working ? 'working' : 'idle'}
      />
    </span>
  );
}
