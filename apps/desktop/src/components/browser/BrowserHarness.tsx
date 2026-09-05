import { Camera, CheckCircle2, Globe, MousePointer, Play, RotateCcw } from 'lucide-react';
import { useState } from 'react';
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
  const [url, setUrl] = useState('https://github.com/trending');
  const [isAutomating, setIsAutomating] = useState(false);
  const { say, setMood } = useMascotStore();

  const [actions, setActions] = useState<BrowserActionLog[]>([
    {
      id: 'a1',
      step: 1,
      type: 'navigate',
      target: 'https://github.com/trending',
      status: 'completed',
      time: '17:04:10',
    },
    {
      id: 'a2',
      step: 2,
      type: 'evaluate',
      target: 'document.querySelectorAll("article.Box-row h2 a")',
      status: 'completed',
      time: '17:04:12',
    },
    {
      id: 'a3',
      step: 3,
      type: 'screenshot',
      target: 'viewport.png (1280x800)',
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
            {/* Viewport content mockup */}
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
                  The agent possesses full Playwright capabilities: clicking buttons, filling forms,
                  solving simple auth challenges, and extracting structured JSON.
                </p>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Badge variant="accent" className="font-mono text-xs">
                  Playwright v1.49 (Permissive MIT)
                </Badge>
                <Badge variant="outline" className="font-mono text-xs">
                  CDP Socket Connected
                </Badge>
              </div>
            </div>
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
