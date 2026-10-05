import { PROVIDER_MARKS } from '@jackalope/brand/provider-marks';
import { Bot } from 'lucide-react';
import { agentProvider } from '../../lib/agent-provider';

/**
 * A provider's product mark, for places where people pick or identify an agent.
 * Live activity keeps the animated AgentAvatar characters.
 */
export function ProviderMark({ provider, size = 18 }: { provider: string; size?: number }) {
  const lower = provider.toLowerCase();
  const id = PROVIDER_MARKS[lower]
    ? lower
    : (Object.keys(PROVIDER_MARKS).find((key) => lower.includes(key)) ?? agentProvider(provider));
  const mark = PROVIDER_MARKS[id];
  if (!mark) return <Bot size={size} aria-hidden="true" />;
  return (
    <svg
      className="provider-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={mark.color ?? 'currentColor'}
      fillRule="evenodd"
      aria-hidden="true"
      focusable="false"
    >
      {mark.paths.map((d) => (
        <path key={d} d={d} clipRule="evenodd" />
      ))}
    </svg>
  );
}
