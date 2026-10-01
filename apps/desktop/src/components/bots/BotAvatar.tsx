import { AgentCharacter, type AgentGaze } from '@jackalope/brand/agent-character';
import { agentProvider } from '../../lib/agent-provider';
import { BOT_COLORS, BOT_STYLES, type BotAppearance } from '../../stores/botStore';

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
  const fallback = agentProvider(agent);
  const style =
    appearance?.style ??
    (BOT_STYLES.some((item) => item.id === fallback) ? fallback : BOT_STYLES[0].id);
  const color = BOT_COLORS.find((item) => item.id === appearance?.color)?.value;
  return (
    <span
      className="bots-avatar"
      data-size={size}
      style={color ? { color } : undefined}
      aria-hidden="true"
    >
      <AgentCharacter provider={style} state={state} gaze={gaze} />
    </span>
  );
}
