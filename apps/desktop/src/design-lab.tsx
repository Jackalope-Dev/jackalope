import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JackalopeMascot } from './components/mascot/JackalopeMascot';
import { ThemeEditor } from './components/theme/ThemeEditor';
import { WorkspaceHeading } from './components/ui/WorkspaceHeading';
import { Button } from './components/ui/button';
import { applyThemeTokens, PRESET_THEMES } from './lib/theme-engine';
import { useMascotStore, type MascotMood } from './stores/mascotStore';
import './index.css';

function DesignLab() {
  const [theme, setTheme] = useState(PRESET_THEMES[0]);
  const [replay, setReplay] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const { mood, setMood } = useMascotStore();
  useEffect(() => applyThemeTokens(theme), [theme]);

  return (
    <main className="h-dvh overflow-y-auto p-8 lg:p-16 bg-[var(--color-shell)]">
      <div className="max-w-5xl mx-auto">
        <WorkspaceHeading eyebrow="Jackalope / living design library" title="A workspace with a little life."
          description="The same character, colors, and controls used in the app. Explore the details here."
          action={<a href="/" className="text-sm text-[var(--color-accent)]">Open workspace →</a>} />
        <div className="grid lg:grid-cols-[1fr_340px] gap-8 mt-6">
          <section className="rounded-3xl bg-[var(--color-bg)] p-8">
            <h2 className="text-sm font-medium">Your quiet companion</h2>
            <div className="h-64 flex items-center justify-center"><JackalopeMascot key={replay} size="lg" showBubble={false} reduceMotion={reduceMotion} /></div>
            <div className="flex flex-wrap justify-center gap-2">
              {(['idle', 'thinking', 'working', 'success', 'sleep'] as MascotMood[]).map((state) => <button key={state} type="button" aria-pressed={mood === state} onClick={() => { setMood(state); setReplay((value) => value + 1); }} className="workspace-nav-item" data-active={mood === state || undefined}>{state}</button>)}
            </div>
            <div className="flex justify-center items-center gap-4 mt-5"><Button variant="ghost" size="sm" onClick={() => setReplay((value) => value + 1)}>Replay motion</Button><label className="flex gap-2 items-center text-xs text-[var(--color-text-secondary)]"><input type="checkbox" checked={reduceMotion} onChange={(event) => setReduceMotion(event.target.checked)} />Reduce motion</label></div>
            <div className="border-t border-[var(--color-border-subtle)] mt-8 pt-6">
              <h2 className="text-sm font-medium mb-5">One recognizable outline</h2>
              <div className="flex gap-7 items-end">{[16, 32, 64, 112].map((size) => <figure key={size} className="text-center"><img src="/app-icon.png" width={size} height={size} alt={`Jackalope head at ${size} pixels`} /><figcaption className="text-[10px] text-[var(--color-text-muted)] mt-3">{size}px</figcaption></figure>)}</div>
            </div>
          </section>
          <section className="rounded-3xl bg-[var(--color-surface)] p-6 self-start"><h2 className="text-sm font-medium mb-6">Find your atmosphere</h2><ThemeEditor value={theme} onChange={setTheme} /><p className="text-[11px] text-[var(--color-text-muted)] mt-6 leading-relaxed">This playground does not change your saved workspace theme. Motion follows your system preference.</p></section>
        </div>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<DesignLab />);
