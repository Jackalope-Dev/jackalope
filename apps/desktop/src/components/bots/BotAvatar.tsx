import { AgentCharacter, type AgentGaze } from '@jackalope/brand/agent-character';
import type { CSSProperties } from 'react';
import { agentProvider } from '../../lib/agent-provider';
import { BOT_COLORS, BOT_STYLES, type BotAppearance } from '../../stores/botStore';

/** The bot's style, mapping earlier choices and falling back to its agent's character. */
export function botStyle(appearance: { style: string } | undefined, agent = 'auto'): string {
  // An early bot style used the thin Kimi crescent, whose face was hard to see.
  if (appearance?.style === 'kimi') return 'moon';
  if (appearance?.style) return appearance.style;
  const fallback = agentProvider(agent);
  return BOT_STYLES.some((item) => item.id === fallback) ? fallback : BOT_STYLES[0].id;
}

/** Every bot's character, drawn from its chosen style and colour. */
export function BotAvatar({
  appearance,
  agent = 'auto',
  size = 'md',
  state = 'idle',
  gaze,
}: {
  appearance?: BotAppearance;
  agent?: string;
  size?: 'md' | 'lg' | 'xl';
  state?: 'idle' | 'working' | 'waiting';
  gaze?: AgentGaze;
}) {
  const style = botStyle(appearance, agent);
  const color = BOT_COLORS.find((item) => item.id === appearance?.color)?.value;
  return (
    <span
      className="bots-avatar"
      data-size={size}
      style={color ? ({ '--agent-color': color } as CSSProperties) : undefined}
      aria-hidden="true"
    >
      <AgentCharacter provider={style} state={state} gaze={gaze} />
    </span>
  );
}
