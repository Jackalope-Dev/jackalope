import { AgentCharacter } from '@jackalope/brand/agent-character';
import { IconButton } from '@jackalope/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useAgentGaze } from '../../hooks/useAgentGaze';
import { BOT_COLORS, BOT_STYLES, type BotAppearance } from '../../stores/botStore';
import { botStyle } from './BotAvatar';

/** Shapes either side of the chosen one; the rest wait off stage. */
const VISIBLE = 2;

/**
 * A carousel of character shapes with colour swatches. Neighbouring shapes slide
 * into the centre as the choice changes, and the centred one follows the pointer.
 */
export function BotAppearancePicker({
  appearance,
  agent,
  onChange,
}: {
  appearance?: BotAppearance;
  agent: string;
  onChange: (appearance: BotAppearance) => void;
}) {
  const style = botStyle(appearance, agent);
  const current = {
    style,
    color: appearance?.color ?? 'ink',
  } as BotAppearance;
  const index = Math.max(
    0,
    BOT_STYLES.findIndex((item) => item.id === style),
  );
  const colour = BOT_COLORS.find((item) => item.id === current.color)?.value;
  const stage = useRef<HTMLDivElement>(null);
  const gaze = useAgentGaze(stage);
  const [bouncing, setBouncing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const change = (next: BotAppearance) => {
    onChange(next);
    setBouncing(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setBouncing(false), 900);
  };
  const choose = (position: number) =>
    change({
      ...current,
      style: BOT_STYLES[(position + BOT_STYLES.length) % BOT_STYLES.length].id,
    });
  const count = BOT_STYLES.length;
  return (
    <section
      className="bot-appearance"
      aria-label="Appearance"
      style={colour ? ({ '--agent-color': colour } as CSSProperties) : undefined}
    >
      <div className="bot-appearance-stage">
        <IconButton
          type="button"
          variant="ghost"
          label="Previous shape"
          onClick={() => choose(index - 1)}
        >
          <ChevronLeft size={20} />
        </IconButton>
        <div className="bot-carousel" ref={stage} aria-hidden="true">
          {BOT_STYLES.map((item, position) => {
            // Shortest signed distance around the ring, so the wrap-around stays hidden.
            const offset =
              ((position - index + count + Math.floor(count / 2)) % count) - Math.floor(count / 2);
            const centred = offset === 0;
            return (
              <button
                key={item.id}
                type="button"
                tabIndex={-1}
                className="bot-carousel-item"
                data-offset={offset}
                data-hidden={Math.abs(offset) > VISIBLE || undefined}
                style={{ '--offset': offset } as CSSProperties}
                onClick={() => !centred && choose(position)}
              >
                <AgentCharacter
                  provider={item.id}
                  state={centred && bouncing ? 'working' : 'idle'}
                  gaze={centred ? gaze : undefined}
                />
              </button>
            );
          })}
        </div>
        <IconButton
          type="button"
          variant="ghost"
          label="Next shape"
          onClick={() => choose(index + 1)}
        >
          <ChevronRight size={20} />
        </IconButton>
      </div>
      <p className="bot-appearance-name" aria-live="polite">
        {BOT_STYLES[index].name}
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
