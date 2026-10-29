import { SegmentedControl } from '@jackalope/ui';
import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { capturedPages, type ReviewCaptures } from '../../lib/review-captures';
import { nativeTask, type ScreenshotArtifact } from '../../lib/task-runtime';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import './review-screenshots.css';

type Mode = 'slider' | 'side';

function useScreenshot(runId: string, artifact: ScreenshotArtifact | null | undefined) {
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setSource('');
    setError('');
    if (!artifact) return;
    let canceled = false;
    let url = '';
    nativeTask<number[]>('task_screenshot', { runId, screenshotId: artifact.id })
      .then((bytes) => {
        if (canceled) return;
        url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
        setSource(url);
      })
      .catch((reason) => {
        if (!canceled) setError(String(reason));
      });
    return () => {
      canceled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [runId, artifact]);
  return { source, error };
}

function Shot({
  label,
  image,
  missing,
}: {
  label: string;
  image: { source: string; error: string };
  missing: string;
}) {
  return (
    <figure className="review-shot">
      <figcaption>{label}</figcaption>
      {image.source ? (
        <img src={image.source} alt={`${label} screenshot`} />
      ) : (
        <p className="review-shot-empty task-muted" role={image.error ? undefined : 'status'}>
          {image.error || missing}
        </p>
      )}
    </figure>
  );
}

export function ReviewScreenshots({
  runId,
  captures,
  onOpenPreview,
}: {
  runId: string;
  captures: ReviewCaptures;
  onOpenPreview?: () => void;
}) {
  const pages = capturedPages(captures);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<Mode>('slider');
  const [split, setSplit] = useState(50);
  const page = pages[Math.min(selected, pages.length - 1)];
  const before = useScreenshot(runId, page?.before);
  const after = useScreenshot(runId, page?.after);
  const comparable = !!page?.before && !!page?.after;
  const effectiveMode: Mode = comparable ? mode : 'side';
  const showBefore = !!page?.before || captures.beforeAvailable;
  const viewport =
    page && `${page.viewport === 'narrow' ? 'Narrow' : 'Desktop'} · ${page.width}×${page.height}`;

  return (
    <section className="review-screenshots" aria-label="Review screenshots">
      <div className="review-screenshots-toolbar">
        {pages.length > 1 && (
          <Select
            aria-label="Captured page"
            value={String(Math.min(selected, pages.length - 1))}
            onValueChange={(value) => setSelected(Number(value))}
          >
            {pages.map((item, index) => (
              <SelectItem key={`${item.path}:${item.viewport}`} value={String(index)}>
                {item.path} · {item.viewport === 'narrow' ? 'Narrow' : 'Desktop'}
              </SelectItem>
            ))}
          </Select>
        )}
        {pages.length === 1 && page && <span className="review-screenshots-path">{page.path}</span>}
        {viewport && <span className="task-muted">{viewport}</span>}
        <div className="review-screenshots-actions">
          {comparable && (
            <SegmentedControl<Mode>
              label="Comparison"
              items={[
                { id: 'slider', label: 'Slider' },
                { id: 'side', label: 'Side by side' },
              ]}
              value={mode}
              onChange={setMode}
            />
          )}
          {onOpenPreview && (
            <Button variant="outline" onClick={onOpenPreview}>
              <ExternalLink size={16} aria-hidden="true" /> Open live preview
            </Button>
          )}
        </div>
      </div>
      {!page && (
        <InlineNotice tone="info">
          No screenshots were saved. The notes below say what happened.
        </InlineNotice>
      )}
      {page && effectiveMode === 'slider' && (
        <div className="review-compare">
          <div className="review-compare-frame">
            {after.source ? (
              <img src={after.source} alt="After screenshot" />
            ) : (
              <p className="review-shot-empty task-muted">{after.error || 'Loading screenshot…'}</p>
            )}
            {before.source && (
              <img
                src={before.source}
                alt="Before screenshot"
                className="review-compare-before"
                style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
              />
            )}
            <span
              className="review-compare-divider"
              style={{ left: `${split}%` }}
              aria-hidden="true"
            />
          </div>
          <label className="review-compare-control">
            <span>Before</span>
            <input
              type="range"
              min={0}
              max={100}
              value={split}
              aria-label="Before and after comparison"
              aria-valuetext={`${split}% before`}
              onChange={(event) => setSplit(Number(event.target.value))}
            />
            <span>After</span>
          </label>
        </div>
      )}
      {page && effectiveMode === 'side' && (
        <div className={showBefore ? 'review-side' : undefined}>
          {showBefore && (
            <Shot label="Before" image={before} missing="No before screenshot of this page." />
          )}
          <Shot
            label={showBefore ? 'After' : 'Result'}
            image={after}
            missing={page.after ? 'Loading screenshot…' : 'No screenshot of the result.'}
          />
        </div>
      )}
      {page && page.criteria.length > 0 && (
        <p className="task-muted">Evidence for {page.criteria.join(', ')}.</p>
      )}
      {captures.notes.length > 0 && (
        <ul className="review-screenshots-notes task-muted">
          {captures.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
