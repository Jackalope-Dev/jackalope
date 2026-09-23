import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import { useEffect, useState } from 'react';
import {
  clearPerformanceSamples,
  isPerformanceRecording,
  performanceSummary,
  setPerformanceRecording,
} from '../../lib/workbench-performance';
import { Button } from '../ui/button';

export function WorkflowPerformance() {
  const [recording, setRecording] = useState(isPerformanceRecording);
  const [summary, setSummary] = useState(performanceSummary);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setSummary(performanceSummary());
    }, 2000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Disclosure className="work-context">
      <DisclosureSummary>Workflow performance · local measurements</DisclosureSummary>
      <div className="work-context-body">
        <p>
          Record timings in this window while you work, then export for comparison. No prompts,
          paths, terminal output or remote uploads. Samples stay in memory until cleared or this
          window closes.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            aria-pressed={recording}
            onClick={() => {
              setPerformanceRecording(!recording);
              setRecording(!recording);
            }}
          >
            {' '}
            {recording ? 'Stop recording' : 'Record locally'}
          </Button>
          <Button
            variant="ghost"
            disabled={!summary.length}
            onClick={() => {
              clearPerformanceSamples();
              setSummary([]);
            }}
          >
            Clear samples
          </Button>
          <Button
            variant="ghost"
            disabled={!summary.length}
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob(
                  [
                    JSON.stringify(
                      {
                        schema: 1,
                        capturedAt: new Date().toISOString(),
                        scope:
                          'This window only; event samples >=16ms; long tasks >=50ms; no cross-user comparison',
                        metrics: performanceSummary(),
                      },
                      null,
                      2,
                    ),
                  ],
                  { type: 'application/json' },
                ),
              );
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = 'jackalope-workflow-performance.json';
              anchor.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Export timings
          </Button>
        </div>
        {summary.length ? (
          <ul>
            {summary.map((row) => (
              <li key={row.metric}>
                {row.metric}: median {Math.round(row.medianMs)} ms · p95 {Math.round(row.p95Ms)} ms
                · {row.samples} samples
              </li>
            ))}
          </ul>
        ) : (
          <p>No samples recorded.</p>
        )}
        <p>
          Compare the same tasks, hardware and provider settings. UI timings do not establish task
          quality or human time saved; use task usage and review measurements alongside them.
        </p>
      </div>
    </Disclosure>
  );
}
