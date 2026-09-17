import { Disclosure, DisclosureSummary, Input } from '@jackalope/ui';
import { useState } from 'react';
import type { SessionLimits as Limits } from '../../lib/live-session';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

export function SessionLimits({
  initial,
  onSave,
  embedded = false,
}: {
  initial?: Limits;
  onSave: (limits: Limits) => Promise<void> | void;
  embedded?: boolean;
}) {
  const [batches, setBatches] = useState(initial?.maxBatches?.toString() ?? '');
  const [cost, setCost] = useState(initial?.pauseAtEstimatedUsd?.toString() ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    setError('');
    setSaved(false);
    if (
      (batches && (!/^\d+$/.test(batches) || Number(batches) < 1 || Number(batches) > 1000)) ||
      (cost && (!Number.isFinite(Number(cost)) || Number(cost) <= 0 || Number(cost) > 100000))
    ) {
      setError(
        'Choose 1–1,000 batches and a positive dollar threshold up to 100,000, or leave limits blank.',
      );
      return;
    }
    setBusy(true);
    try {
      await onSave({
        maxBatches: batches ? Number(batches) : null,
        pauseAtEstimatedUsd: cost ? Number(cost) : null,
      });
      setSaved(true);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const content = (
    <div className="space-y-3 py-3">
      <label className="block">
        Pause after this many batches
        <Input
          type="number"
          min={1}
          max={1000}
          step={1}
          disabled={busy}
          value={batches}
          onChange={(event) => {
            setBatches(event.target.value);
            setSaved(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (!busy) void save();
            }
          }}
        />
      </label>
      <label className="block">
        Pause at estimated cost (USD)
        <Input
          type="number"
          min={0.01}
          max={100000}
          step={0.01}
          disabled={busy}
          value={cost}
          onChange={(event) => {
            setCost(event.target.value);
            setSaved(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (!busy) void save();
            }
          }}
        />
      </label>
      <p className="task-muted">
        Limits pause the next batch. A running batch can exceed the estimate. Missing cost reports
        pause further work when a cost threshold is set. This is not a provider billing cap. Blank
        fields remove limits.
      </p>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void save()}>
        Save limits
      </Button>
      {saved && <p role="status">Limits saved.</p>}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </div>
  );
  return embedded ? (
    content
  ) : (
    <Disclosure className="my-3">
      <DisclosureSummary>
        Session limits{initial?.maxBatches ? ` · ${initial.maxBatches} batches` : ''}
      </DisclosureSummary>
      {content}
    </Disclosure>
  );
}
