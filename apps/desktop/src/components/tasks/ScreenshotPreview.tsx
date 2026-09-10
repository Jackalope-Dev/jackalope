import { useEffect, useState } from 'react';
import { nativeTask, type ScreenshotArtifact } from '../../lib/task-runtime';
import { Button } from '../ui/button';

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
    nativeTask<number[]>('task_screenshot', { runId, screenshotId: screenshot.id })
      .then((bytes) => {
        if (canceled) return;
        url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
        setSource(url);
      })
      .catch((error) => {
        if (!canceled) setError(String(error));
      });
    return () => {
      canceled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [runId, screenshot.id]);

  if (error)
    return (
      <div className="py-6 space-y-3">
        <p role="alert" className="task-error">
          {error}
        </p>
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
