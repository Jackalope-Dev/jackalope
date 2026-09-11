import { applyThemeTokens, DEFAULT_THEME, startThemeClock } from '@jackalope/brand/theme';
import { Checkbox } from '@jackalope/ui';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentAvatar } from './components/agents/AgentAvatar';
import { LocalAiSetup } from './components/agents/LocalAiSetup';
import { JackalopeMascot } from './components/mascot/JackalopeMascot';
import { ThemeEditor } from './components/theme/ThemeEditor';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Select, SelectItem } from './components/ui/Select';
import { WorkspaceHeading } from './components/ui/WorkspaceHeading';
import { localAiFixture } from './design-lab/local-ai-fixture';
import { TaskExperienceExamples } from './design-lab/TaskExperienceExamples';
import { type MascotMood, useMascotStore } from './stores/mascotStore';
import './index.css';
import './components/ui/experience.css';
import './components/agents/agents-workspace.css';

function DesignLab() {
  useEffect(startThemeClock, []);
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [replay, setReplay] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [period, setPeriod] = useState('30');
  const [agentState, setAgentState] = useState('idle');
  const { mood, setMood } = useMascotStore();
  useEffect(() => applyThemeTokens(theme), [theme]);

  return (
    <main className="h-dvh overflow-y-auto p-8 lg:p-16 bg-[var(--color-shell)]">
      <div className="max-w-5xl mx-auto">
        <p className="mb-3 text-sm">
          Local setup fixture: browser state only; no installation, download or native tasks.
        </p>
        <LocalAiSetup preview={localAiFixture} />
        <WorkspaceHeading
          title="Design library"
          description="The same character, colors, and controls used in the app. Explore the details here."
          action={
            <a href="/" className="text-sm text-[var(--color-accent-ink)]">
              Open workspace →
            </a>
          }
        />
        <div className="grid lg:grid-cols-[1fr_340px] gap-8 mt-6">
          <section className="rounded-3xl bg-[var(--color-bg)] p-8">
            <h2 className="text-sm font-medium">Your quiet companion</h2>
            <div className="h-64 flex items-center justify-center">
              <JackalopeMascot
                key={replay}
                size="lg"
                showBubble={false}
                reduceMotion={reduceMotion}
              />
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {(['idle', 'thinking', 'working', 'success', 'sleep'] as MascotMood[]).map(
                (state) => (
                  <button
                    key={state}
                    type="button"
                    aria-pressed={mood === state}
                    onClick={() => {
                      setMood(state);
                      setReplay((value) => value + 1);
                    }}
                    className="workspace-nav-item"
                    data-active={mood === state || undefined}
                  >
                    {state}
                  </button>
                ),
              )}
            </div>
            <div className="flex justify-center items-center gap-4 mt-5">
              <Button variant="ghost" size="sm" onClick={() => setReplay((value) => value + 1)}>
                Replay motion
              </Button>
              <label className="flex gap-2 items-center text-xs text-[var(--color-text-secondary)]">
                <Checkbox
                  checked={reduceMotion}
                  onChange={(event) => setReduceMotion(event.target.checked)}
                />
                Reduce motion
              </label>
            </div>
            <div className="border-t border-[var(--color-border-subtle)] mt-8 pt-6">
              <h2 className="text-sm font-medium mb-5">One recognizable outline</h2>
              <div className="flex gap-7 items-end">
                {[16, 32, 64, 112].map((size) => (
                  <figure key={size} className="text-center">
                    <img
                      src="/app-icon.png"
                      width={size}
                      height={size}
                      alt={`Jackalope head at ${size} pixels`}
                    />
                    <figcaption className="text-xs text-[var(--color-text-muted)] mt-3">
                      {size}px
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>
          <section className="rounded-3xl bg-[var(--color-surface)] p-6 self-start">
            <h2 className="text-sm font-medium mb-6">Find your atmosphere</h2>
            <ThemeEditor value={theme} onChange={setTheme} />
            <p className="text-xs text-[var(--color-text-muted)] mt-6 leading-relaxed">
              This playground does not change your saved workspace theme. Motion follows your system
              preference.
            </p>
          </section>
        </div>
        <section
          className="rounded-3xl bg-[var(--color-bg)] p-8 mt-8"
          aria-labelledby="controls-title"
        >
          <h2 id="controls-title" className="text-sm font-medium">
            Considered controls
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)] mt-2">
            Open a menu, use the arrow keys, or switch appearance. Every state belongs to your
            theme.
          </p>
          <div className="grid sm:grid-cols-3 gap-6 mt-6">
            <label
              htmlFor="design-lab-field-1"
              className="grid gap-2 text-xs text-[var(--color-text-secondary)]"
            >
              Period
              <Select
                id="design-lab-field-1"
                aria-label="Period"
                value={period}
                onValueChange={setPeriod}
              >
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </Select>
            </label>
            <label
              htmlFor="design-lab-field-2"
              className="grid gap-2 text-xs text-[var(--color-text-secondary)]"
            >
              Project name
              <Input id="design-lab-field-2" placeholder="Name your project" />
            </label>
            <label
              htmlFor="design-lab-field-3"
              className="grid gap-2 text-xs text-[var(--color-text-secondary)]"
            >
              Unavailable connection
              <Select
                id="design-lab-field-3"
                aria-label="Unavailable connection"
                value="unavailable"
                disabled
              >
                <SelectItem value="unavailable">No connection available</SelectItem>
              </Select>
            </label>
          </div>
        </section>
        <section className="rounded-3xl bg-[var(--color-bg)] p-8 mt-8">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-base font-medium">Agent characters</h2>
              <p className="task-muted mt-2">Example poses only. No agents are running.</p>
            </div>
            <Select aria-label="Agent pose" value={agentState} onValueChange={setAgentState}>
              <SelectItem value="idle">Idle</SelectItem>
              <SelectItem value="working">Working</SelectItem>
              <SelectItem value="waiting">Needs input</SelectItem>
            </Select>
          </div>
          <div className="flex flex-wrap gap-8">
            {['codex', 'claude', 'grok', 'kimi', 'opencode', 'antigravity', 'custom'].map(
              (provider) => (
                <figure key={provider} className="grid justify-items-center gap-3">
                  <AgentAvatar
                    provider={provider}
                    working={agentState === 'working'}
                    waiting={agentState === 'waiting'}
                  />
                  <figcaption className="text-xs text-[var(--color-text-secondary)]">
                    {provider}
                  </figcaption>
                </figure>
              ),
            )}
          </div>
        </section>
        <TaskExperienceExamples />
      </div>
    </main>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<DesignLab />);
