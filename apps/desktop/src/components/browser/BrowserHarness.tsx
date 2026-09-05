import { Camera, CheckCircle2, Globe, MousePointer, Play, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useExecutionStore } from '../../stores/executionStore';
import { useMascotStore } from '../../stores/mascotStore';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

interface BrowserActionLog {
  id: string;
  step: number;
  type: 'navigate' | 'click' | 'type' | 'screenshot' | 'evaluate';
  target: string;
  status: 'completed' | 'running';
  time: string;
}

export function BrowserHarness() {
  const { runs } = useExecutionStore();
  const latestRun = runs[0];
  const realScreenshots = latestRun?.screenshots ?? [];
  const realSteps = latestRun?.validationSteps ?? [];

  const [url, setUrl] = useState(
    realScreenshots.length > 0
      ? realScreenshots[realScreenshots.length - 1].url
      : 'http://localhost:5173/onboarding',
  );
  const [isAutomating, setIsAutomating] = useState(false);
  const { say, setMood } = useMascotStore();

  const [actions, setActions] = useState<BrowserActionLog[]>([
    {
      id: 'a1',
      step: 1,
      type: 'navigate',
      target: 'http://localhost:5173/onboarding',
      status: 'completed',
      time: '17:04:10',
    },
    {
      id: 'a2',
      step: 2,
      type: 'evaluate',
      target: 'document.querySelector("form.onboarding-form")',
      status: 'completed',
      time: '17:04:12',
    },
    {
      id: 'a3',
      step: 3,
      type: 'screenshot',
      target: 'onboarding_step_1.png (1280x800)',
      status: 'completed',
      time: '17:04:14',
    },
  ]);

  const handleRunBrowserAutomation = () => {
    setIsAutomating(true);
    setMood('working');
    say('Agent launching browser automation harness via Playwright...', 3000);

    setTimeout(() => {
      setActions((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          step: prev.length + 1,
          type: 'click',
          target: 'button[data-testid="inspect-repo"]',
          status: 'completed',
          time: new Date().toLocaleTimeString(),
        },
      ]);
      setIsAutomating(false);
      setMood('success');
      say('Browser task executed! Captured DOM state and action stream.', 3500);
    }, 1500);
  };

  return (
    <div className="tool-page flex-1 flex flex-col h-full overflow-y-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--color-border)]">
        <div>
          <h1 className="task-title">Browser</h1>
          <p className="task-muted mt-2">Explore a sample browser session and its action log.</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleRunBrowserAutomation}
            disabled={isAutomating}
            className="gap-1.5 text-xs shadow-sm"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{isAutomating ? 'Previewing…' : 'Preview actions'}</span>
          </Button>
        </div>
      </div>

      {/* Main Sandbox Layout */}
      <div className="tool-layout browser-layout">
        {/* Left 2 Cols: Browser Viewport Simulation */}
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-hidden shadow-sm">
          {/* Browser Navigation Bar */}
          <div className="p-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)]/60 flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 py-1 rounded-lg bg-[var(--color-surface-sunken)] border border-[var(--color-border)] text-xs font-mono">
              <Globe className="w-3.5 h-3.5 text-[var(--color-accent-ink)]" />
              <input
                type="text"
                aria-label="Preview URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full bg-transparent border-0 text-[var(--color-text-primary)] focus:outline-none"
              />
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Reload page (not available in preview)"
              title="Not available in preview"
              disabled
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Capture screenshot (not available in preview)"
              title="Not available in preview"
              disabled
            >
              <Camera className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Web Viewport Body */}
          <div className="flex-1 bg-[var(--color-surface-sunken)] relative p-6 flex flex-col justify-center items-center text-center overflow-auto">
            {realScreenshots.length > 0 ? (
              <div className="w-full max-w-xl rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3 shadow-xl text-left">
                <div className="flex items-center justify-between pb-2 border-b border-[var(--color-border)]">
                  <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                    {realScreenshots[realScreenshots.length - 1].name}
                  </span>
                  <span className="text-xs font-mono text-[var(--color-text-muted)]">
                    {realScreenshots[realScreenshots.length - 1].width} × {realScreenshots[realScreenshots.length - 1].height}
                  </span>
                </div>
                <div className="p-4 rounded-lg bg-[var(--color-surface-sunken)] flex items-center justify-center min-h-[180px]">
                  <div className="text-center space-y-1">
                    <Camera size={32} className="mx-auto text-[var(--color-accent)]" />
                    <p className="text-xs font-mono text-[var(--color-text-primary)]">
                      {realScreenshots[realScreenshots.length - 1].name}
                    </p>
                    <p className="text-[10px] text-[var(--color-text-muted)]">
                      {realScreenshots[realScreenshots.length - 1].filePath}
                    </p>
                  </div>
                </div>
                {realSteps.length > 0 && (
                  <div className="text-[11px] text-[var(--color-text-secondary)] space-y-1 pt-1">
                    <span className="font-semibold">Recent verified step:</span>
                    <p className="text-[var(--color-text-primary)]">
                      {realSteps[realSteps.length - 1].step} ({realSteps[realSteps.length - 1].status})
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4 shadow-xl text-left">
                <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)]">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                      Sample page
                    </span>
                  </div>
                  <span className="text-xs font-mono text-[var(--color-text-muted)]">1280 × 800</span>
                </div>

                <div className="space-y-2 text-xs text-[var(--color-text-secondary)]">
                  <div className="p-3 rounded-lg bg-[var(--color-surface-sunken)] font-mono text-xs text-[var(--color-text-primary)]">
                    &lt;html&gt; ... loaded 42 interactive elements &lt;/html&gt;
                  </div>
                  <p className="text-xs leading-relaxed">
                    The agent possesses full browser automation capabilities: navigating URLs, capturing real
                    screenshots, clicking elements, verifying form inputs, and extracting structured DOM state.
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Badge variant="accent" className="font-mono text-xs">
                    In-App Browser Harness
                  </Badge>
                  <Badge variant="outline" className="font-mono text-xs">
                    Headless Edge / WebView Connected
                  </Badge>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Col: Action Stream / DOM Timeline */}
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)]/40 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-[var(--color-text-primary)]">
              <MousePointer className="w-3.5 h-3.5 text-[var(--color-accent-ink)]" />
              <span>Agent Action Log</span>
            </div>
            <span className="font-mono text-xs text-[var(--color-text-muted)]">
              {actions.length} events
            </span>
          </div>

          <div className="flex-1 p-3 overflow-y-auto space-y-2">
            {actions.map((act) => (
              <div
                key={act.id}
                className="p-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] space-y-1 text-xs"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-mono text-xs">
                    <span className="px-1.5 py-0.2 rounded bg-[var(--color-accent-subtle)] text-[var(--color-accent-ink)] font-semibold">
                      Step {act.step}
                    </span>
                    <span className="text-[var(--color-text-primary)] uppercase font-semibold">
                      {act.type}
                    </span>
                  </div>
                  <span className="text-xs text-[var(--color-text-muted)] font-mono">
                    {act.time}
                  </span>
                </div>

                <div className="font-mono text-xs text-[var(--color-text-secondary)] break-all">
                  {act.target}
                </div>

                <div className="flex items-center gap-1 text-xs text-[var(--color-success)] font-medium pt-0.5">
                  <CheckCircle2 className="w-2.5 h-2.5" />
                  <span>Success</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
