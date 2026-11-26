import { Badge, Switch, ThinkingOrb, type ThinkingOrbState } from '@jackalope/ui';
import { useState } from 'react';

const STATES: { state: ThinkingOrbState; label: string }[] = [
  { state: 'working', label: 'Working' },
  { state: 'searching', label: 'Searching the code' },
  { state: 'solving', label: 'Running checks' },
  { state: 'composing', label: 'Writing changes' },
  { state: 'breathing', label: 'Thinking' },
  { state: 'connecting', label: 'Preparing workspace' },
  { state: 'planning', label: 'Planning' },
];

/** Fixture only: every orb state at each size, beside the copy it accompanies in the app. */
export function ThinkingOrbLab() {
  const [paused, setPaused] = useState(false);
  return (
    <section className="grid gap-6">
      <label className="flex items-center gap-3 text-sm">
        <Switch checked={paused} onCheckedChange={setPaused} aria-label="Pause orbs" />
        Pause
      </label>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
        {STATES.map(({ state, label }) => (
          <figure
            key={state}
            className="m-0 grid justify-items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4"
          >
            <ThinkingOrb state={state} size={64} paused={paused} />
            <div className="flex items-end gap-4">
              <ThinkingOrb state={state} size={32} paused={paused} />
              <ThinkingOrb state={state} size={20} paused={paused} />
            </div>
            <figcaption className="ui-thinking-status text-xs text-[var(--color-text-secondary)]">
              <ThinkingOrb state={state} size={20} paused={paused} aria-hidden="true" />
              {label}…
            </figcaption>
            <Badge appearance="plain">
              <ThinkingOrb state={state} size={20} paused={paused} aria-hidden="true" />
              {label}
            </Badge>
          </figure>
        ))}
      </div>
    </section>
  );
}
