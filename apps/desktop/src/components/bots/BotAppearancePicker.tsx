import { IconButton } from '@jackalope/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAgentGaze } from '../../hooks/useAgentGaze';
import { agentProvider } from '../../lib/agent-provider';
import { BOT_COLORS, BOT_STYLES, type BotAppearance } from '../../stores/botStore';
import { BotAvatar } from './BotAvatar';

/** Large live preview with style arrows and colour swatches. */
export function BotAppearancePicker({
  appearance,
  agent,
  onChange,
}: {
  appearance?: BotAppearance;
  agent: string;
  onChange: (appearance: BotAppearance) => void;
}) {
  const fallback = agentProvider(agent);
  const current: BotAppearance = appearance ?? {
    style: BOT_STYLES.find((item) => item.id === fallback)?.id ?? BOT_STYLES[0].id,
    color: 'ink',
  };
  const index = Math.max(
    0,
    BOT_STYLES.findIndex((item) => item.id === current.style),
  );
  const stage = useRef<HTMLDivElement>(null);
  const gaze = useAgentGaze(stage);
  // A short bounce acknowledges each change; AgentCharacter honours reduced motion.
  const [bouncing, setBouncing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const change = (next: BotAppearance) => {
    onChange(next);
    setBouncing(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setBouncing(false), 900);
  };
  const cycle = (step: number) =>
    change({
      ...current,
      style: BOT_STYLES[(index + step + BOT_STYLES.length) % BOT_STYLES.length].id,
    });
  return (
    <section className="bot-appearance" aria-label="Appearance">
      <div className="bot-appearance-stage" ref={stage}>
        <IconButton type="button" variant="ghost" label="Previous style" onClick={() => cycle(-1)}>
          <ChevronLeft size={20} />
        </IconButton>
        <BotAvatar
          appearance={current}
          size="xl"
          state={bouncing ? 'working' : 'idle'}
          gaze={gaze}
        />
        <IconButton type="button" variant="ghost" label="Next style" onClick={() => cycle(1)}>
          <ChevronRight size={20} />
        </IconButton>
      </div>
      <p className="bot-appearance-name" aria-live="polite">
        {BOT_STYLES[index].name}
        <span>
          {index + 1} of {BOT_STYLES.length}
        </span>
      </p>
      <fieldset className="bot-appearance-colors">
        <legend className="sr-only">Colour</legend>
        {BOT_COLORS.map((color) => (
          <label key={color.id} className="bot-appearance-swatch" title={color.name}>
            <input
              type="radio"
              name="bot-appearance-color"
              className="sr-only"
              checked={color.id === current.color}
              aria-label={color.name}
              onChange={() => change({ ...current, color: color.id })}
            />
            <span style={{ background: color.value }} />
          </label>
        ))}
      </fieldset>
    </section>
  );
}
