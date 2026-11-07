import { Button, InlineNotice } from '@jackalope/ui';
import { useEffect, useState } from 'react';
import { describeError } from '../../lib/errors';
import { invokeNative } from '../../lib/native/transport';
import type { ScreenshotArtifact } from '../../lib/run-types';

export function ScreenshotPreview({
  runId,
  screenshot,
  onRetry,
}: {
  runId: string;
  screenshot: ScreenshotArtifact;
  onRetry: () => void;
}) {
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let canceled = false;
    let url = '';
    invokeNative<number[]>('task_screenshot', { runId, screenshotId: screenshot.id })
      .then((bytes) => {
        if (canceled) return;
        url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
        setSource(url);
      })
      .catch((error) => {
        if (!canceled) setError(describeError(error));
      });
    return () => {
      canceled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [runId, screenshot.id]);

  if (error)
    return (
      <div className="py-6 space-y-3">
        <InlineNotice tone="error">{error}</InlineNotice>
        <p className="task-muted">The original file location is listed above.</p>
        <Button variant="outline" onClick={onRetry}>
          Retry image
        </Button>
      </div>
    );
  if (!source)
    return (
      <p role="status" className="task-muted py-6">
        Loading screenshot…
      </p>
    );
  return (
    <img
      src={source}
      alt={screenshot.name}
      className="mt-5 w-full h-auto rounded-lg"
      onError={() => setError('This screenshot could not be displayed.')}
    />
  );
}
