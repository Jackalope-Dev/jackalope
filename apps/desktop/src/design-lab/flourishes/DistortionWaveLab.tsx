import {
  Button,
  DistortionWave,
  type DistortionWaveType,
  SegmentedControl,
  Textarea,
} from '@jackalope/ui';
import { useRef, useState } from 'react';

const types: { id: DistortionWaveType; label: string }[] = [
  { id: 'vertical', label: 'Vertical' },
  { id: 'horizontal', label: 'Horizontal' },
  { id: 'center', label: 'Center' },
];

/** Fixture only: the wave swaps a fake composer for a sent view; nothing is sent. */
export function DistortionWaveLab() {
  const [type, setType] = useState<DistortionWaveType>('vertical');
  const [sent, setSent] = useState(false);
  const [text, setText] = useState('Tidy the search results page and add keyboard navigation');
  const send = useRef<HTMLButtonElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const card =
    'flex min-h-56 flex-col gap-3 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5';
  return (
    <section className="flex flex-col gap-4">
      <SegmentedControl label="Wave type" items={types} value={type} onChange={setType} />
      <DistortionWave
        revealed={sent}
        type={type}
        source={type === 'center' ? mark : undefined}
        style={{ maxWidth: 620 }}
        overlay={
          <div className="absolute right-5 bottom-5 flex gap-2">
            {sent ? (
              <Button variant="outline" onClick={() => setSent(false)}>
                Back
              </Button>
            ) : (
              <Button ref={send} disabled={!text.trim()} onClick={() => setSent(true)}>
                Send
              </Button>
            )}
          </div>
        }
        revealedContent={
          <div className={card}>
            <div className="flex items-center gap-3">
              <span
                ref={mark}
                className="size-9 rounded-full bg-[var(--color-accent-subtle)]"
                aria-hidden="true"
              />
              <strong className="text-[var(--color-text-primary)]">Sent to the agent</strong>
            </div>
            <p className="text-sm text-[var(--color-text-secondary)]">{text}</p>
          </div>
        }
      >
        <div className={card}>
          <Textarea
            aria-label="Message"
            value={text}
            rows={4}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
      </DistortionWave>
    </section>
  );
}
