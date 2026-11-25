import { DEFAULT_THEME, themeTokens } from '@jackalope/brand/theme';
import {
  BorderBeam,
  BorderBeamLayer,
  type BorderBeamVariant,
  Button,
  SearchField,
  SegmentedControl,
  Switch,
} from '@jackalope/ui';
import { type CSSProperties, type RefObject, useEffect, useMemo, useRef, useState } from 'react';

const VARIANTS = [
  { id: 'travel', label: 'Travel' },
  { id: 'line', label: 'Line' },
  { id: 'pulse', label: 'Pulse' },
] as const;

/** Fixture only: a fake microphone level, so the voice pulse can be seen without recording. */
function useFakeLevel(on: boolean, target: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = target.current;
    if (!on || !node) return;
    let frame = 0;
    const tick = (time: number) => {
      const speech = Math.max(0, Math.sin(time / 180) * Math.sin(time / 730));
      node.style.setProperty('--voice-level', (speech * 0.9 + Math.random() * 0.1).toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      node.style.removeProperty('--voice-level');
    };
  }, [on, target]);
}

function Sample({
  dark,
  variant,
  active,
  strength,
  voice,
}: {
  dark: boolean;
  variant: BorderBeamVariant;
  active: boolean;
  strength: number;
  voice: boolean;
}) {
  const tokens = useMemo(
    () => themeTokens({ ...DEFAULT_THEME, isDark: dark, appearance: 'manual' }) as CSSProperties,
    [dark],
  );
  const composer = useRef<HTMLDivElement>(null);
  useFakeLevel(voice && variant === 'pulse', composer);
  const [query, setQuery] = useState('flaky test');
  return (
    <div
      style={tokens}
      className="rounded-3xl bg-[var(--color-shell)] p-6 grid gap-5 text-[var(--color-text-primary)]"
    >
      <p className="text-xs text-[var(--color-text-muted)]">{dark ? 'Dark' : 'Light'}</p>
      <div
        ref={composer}
        className="relative rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-4"
      >
        <BorderBeamLayer
          variant={variant}
          active={active}
          strength={strength}
          level={voice && variant === 'pulse' ? 'var(--voice-level, 0)' : undefined}
        />
        <p className="min-h-14 text-sm text-[var(--color-text-secondary)]">
          Fix the flaky checkout test and explain what changed…
        </p>
        <div className="flex justify-end">
          <Button size="sm">Send</Button>
        </div>
      </div>
      <SearchField
        aria-label="Search fixture"
        value={query}
        onValueChange={setQuery}
        busy={active && variant === 'line'}
      />
      <div className="flex">
        <BorderBeam
          variant="pulse"
          active={active && variant === 'pulse' && !voice}
          strength={0.55}
        >
          <div className="rounded-[var(--radius-xl)] bg-[var(--color-surface)] px-4 py-3 text-sm">
            The agent needs your input
          </div>
        </BorderBeam>
      </div>
    </div>
  );
}

/** Fixture-only playground for BorderBeam: no task runs or native calls. */
export function BorderBeamLab() {
  const [variant, setVariant] = useState<BorderBeamVariant>('travel');
  const [active, setActive] = useState(true);
  const [voice, setVoice] = useState(false);
  const [strength, setStrength] = useState(1);
  return (
    <section className="rounded-3xl bg-[var(--color-bg)] p-8 mt-8" aria-labelledby="beam-title">
      <h2 id="beam-title" className="text-sm font-medium">
        Border beam
      </h2>
      <p className="text-xs text-[var(--color-text-muted)] mt-1 mb-5">
        Travel while an agent works, line while a field loads, pulse while waiting on you or
        listening.
      </p>
      <div className="flex flex-wrap items-center gap-5 mb-6">
        <SegmentedControl label="Beam" items={VARIANTS} value={variant} onChange={setVariant} />
        <Switch label="Active" checked={active} onCheckedChange={setActive} />
        <Switch label="Microphone level" checked={voice} onCheckedChange={setVoice} />
        <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          Strength
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={strength}
            onChange={(event) => setStrength(Number(event.target.value))}
          />
        </label>
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        {[false, true].map((dark) => (
          <Sample
            key={String(dark)}
            dark={dark}
            variant={variant}
            active={active}
            strength={strength}
            voice={voice}
          />
        ))}
      </div>
    </section>
  );
}
