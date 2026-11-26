import { AgentCharacter, type AgentCharacterState } from '@jackalope/brand/agent-character';
import { SegmentedControl } from '@jackalope/ui';
import { type CSSProperties, useRef, useState } from 'react';
import { useAgentGaze } from '../../hooks/useAgentGaze';
import { BOT_COLORS, BOT_STYLES } from '../../stores/botStore';

const STATES: AgentCharacterState[] = ['idle', 'working', 'waiting'];
const SIZES = [36, 56, 112];

/** Fixture-only: every bot shape and state, with no bots or runs behind it. */
export function BotAvatarLab() {
  const [material, setMaterial] = useState<'plush' | 'flat'>('plush');
  const [color, setColor] = useState<string>('violet');
  const [size, setSize] = useState('56');
  const stage = useRef<HTMLDivElement>(null);
  const gaze = useAgentGaze(stage);
  const tint = BOT_COLORS.find((item) => item.id === color)?.value;

  return (
    <section
      className="grid gap-6"
      aria-label="Bot avatars"
      style={tint ? ({ '--agent-color': tint } as CSSProperties) : undefined}
    >
      <div className="flex flex-wrap items-center gap-4">
        <SegmentedControl
          label="Material"
          items={[
            { id: 'plush', label: 'Plush' },
            { id: 'flat', label: 'Flat' },
          ]}
          value={material}
          onChange={setMaterial}
        />
        <SegmentedControl
          label="Size"
          items={SIZES.map((value) => ({ id: String(value), label: `${value}px` }))}
          value={size}
          onChange={setSize}
        />
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Colour</legend>
          {BOT_COLORS.map((item) => (
            <label
              key={item.id}
              className="grid size-7 cursor-pointer place-items-center rounded-full border border-[var(--color-border)]"
              style={{ background: item.value }}
              title={item.name}
            >
              <input
                type="radio"
                name="bot-lab-colour"
                className="sr-only"
                checked={color === item.id}
                onChange={() => setColor(item.id)}
              />
              <span className="sr-only">{item.name}</span>
              {color === item.id && (
                <span className="size-2 rounded-full bg-[var(--color-surface)]" />
              )}
            </label>
          ))}
        </fieldset>
      </div>

      <div ref={stage} className="flex items-center gap-6">
        <span style={{ width: 112, height: 112 }}>
          <AgentCharacter provider="blob" material={material} gaze={gaze} interactive />
        </span>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Follows the pointer. Click any character marked interactive to make it hop.
        </p>
      </div>

      <div className="grid gap-4">
        {STATES.map((state) => (
          <div key={state} className="grid gap-2">
            <h3 className="text-sm font-semibold capitalize">{state}</h3>
            <div className="flex flex-wrap gap-x-4 gap-y-6 pt-4">
              {BOT_STYLES.map((item) => (
                <span
                  key={item.id}
                  title={item.name}
                  style={{ width: Number(size), height: Number(size) }}
                >
                  <AgentCharacter
                    provider={item.id}
                    state={state}
                    material={material}
                    interactive
                  />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
