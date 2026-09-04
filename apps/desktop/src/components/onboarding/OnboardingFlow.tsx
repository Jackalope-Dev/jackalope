import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { JackalopeMascot } from '../mascot/JackalopeMascot';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useThemeStore } from '../../stores/themeStore';
import { useMascotStore } from '../../stores/mascotStore';
import { PRESET_THEMES } from '../../lib/theme-engine';
import {
  ArrowRight,
  CheckCircle2,
  FolderGit2,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface OnboardingFlowProps {
  onComplete: () => void;
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<number>(1);
  const { currentTheme, setTheme } = useThemeStore();
  const { say, setMood } = useMascotStore();

  const [repoPath, setRepoPath] = useState('c:/Users/developer/Desktop/jackalope');
  const [selectedAgent, setSelectedAgent] = useState<'claude' | 'aider' | 'ollama' | 'antigravity'>('claude');

  const handleNext = () => {
    if (step === 1) {
      say('Pick your favorite accent! Surfaces adapt in real-time.', 4000);
      setMood('idle');
      setStep(2);
    } else if (step === 2) {
      say('Which AI agent harness shall we connect first?', 4000);
      setMood('thinking');
      setStep(3);
    } else if (step === 3) {
      say('Point us to your workspace to spin out worktrees.', 4000);
      setMood('idle');
      setStep(4);
    } else if (step === 4) {
      say('All set! Let us harness your agent fleet.', 5000);
      setMood('success');
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: [currentTheme.accentHex, '#ffffff', '#6366f1'],
      });
      setStep(5);
    } else {
      onComplete();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-bg)]/90 backdrop-blur-md p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)]/50">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
              Welcome to Jackalope
            </span>
          </div>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === step
                    ? 'w-6 bg-[var(--color-accent)]'
                    : i < step
                    ? 'w-2 bg-[var(--color-accent)]/50'
                    : 'w-2 bg-[var(--color-border)]'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Dynamic Step Content */}
        <div className="p-8 flex flex-col items-center text-center">
          {/* Animated Mascot Anchor */}
          <div className="mb-6 flex justify-center">
            <JackalopeMascot
              size={step === 5 ? 'lg' : 'md'}
              showBubble={true}
              overrideMood={step === 5 ? 'success' : step === 3 ? 'thinking' : 'idle'}
            />
          </div>

          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-3 max-w-md"
              >
                <h2 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
                  The Ultra-Performant Desktop Shell for Multi-Agent Workflows
                </h2>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  Jackalope orchestrates autonomous AI agents across isolated git worktrees,
                  proactively clarifies requirements, and visualizes your codebase—fast,
                  responsive, and cross-platform.
                </p>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step-2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4 w-full max-w-md"
              >
                <div>
                  <h3 className="text-xl font-bold text-[var(--color-text-primary)]">
                    Choose Your Atmosphere
                  </h3>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                    Arc & Zen browser-style dynamic theming with real-time surface tinting.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2">
                  {PRESET_THEMES.map((theme) => {
                    const isSelected = currentTheme.id === theme.id;
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => setTheme(theme)}
                        className={`flex items-center gap-2 p-2.5 rounded-xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-text-primary)] shadow-sm'
                            : 'border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]'
                        }`}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                          style={{ backgroundColor: theme.accentHex }}
                        />
                        <span className="text-xs font-medium truncate">{theme.name}</span>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step-3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4 w-full max-w-md"
              >
                <div>
                  <h3 className="text-xl font-bold text-[var(--color-text-primary)]">
                    Select Default Agent Harness
                  </h3>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                    You can add and switch between multiple agent accounts and CLI tools anytime.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  {[
                    { id: 'claude', name: 'Claude Code', desc: 'Anthropic CLI harness' },
                    { id: 'antigravity', name: 'Antigravity', desc: 'DeepMind agent runtime' },
                    { id: 'aider', name: 'Aider', desc: 'Multi-file git pairing' },
                    { id: 'ollama', name: 'Local Ollama', desc: 'Private offline LLMs' },
                  ].map((ag) => (
                    <button
                      key={ag.id}
                      type="button"
                      onClick={() => setSelectedAgent(ag.id as any)}
                      className={`flex flex-col p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        selectedAgent === ag.id
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                          : 'border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                          {ag.name}
                        </span>
                        {selectedAgent === ag.id && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                        )}
                      </div>
                      <span className="text-[11px] text-[var(--color-text-secondary)]">
                        {ag.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {step === 4 && (
              <motion.div
                key="step-4"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4 w-full max-w-md"
              >
                <div>
                  <h3 className="text-xl font-bold text-[var(--color-text-primary)]">
                    Workspace Repository
                  </h3>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                    Isolated git worktrees will be spawned directly from this root.
                  </p>
                </div>

                <div className="text-left space-y-2 pt-1">
                  <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                    Local Git Repository Path
                  </label>
                  <div className="flex gap-2">
                    <Input
                      value={repoPath}
                      onChange={(e) => setRepoPath(e.target.value)}
                      className="font-mono text-xs"
                    />
                    <Button variant="secondary" size="icon" title="Browse repository">
                      <FolderGit2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <span className="text-[11px] text-[var(--color-text-muted)] block">
                    Verified: Git repository detected on branch <code>main</code>.
                  </span>
                </div>
              </motion.div>
            )}

            {step === 5 && (
              <motion.div
                key="step-5"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-3 max-w-md"
              >
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-400 text-xs font-semibold border border-emerald-500/20">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Jackalope Initialized</span>
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
                  Ready to Leap into Action!
                </h2>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  Your workspace is ready. You can create task tickets, trigger proactive prompt
                  refinements, and let your agent fleet build in parallel.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom Actions Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface-elevated)]/30">
          <div className="text-xs text-[var(--color-text-muted)]">
            {step < 5 ? `Step ${step} of 5` : 'Setup complete'}
          </div>
          <Button onClick={handleNext} className="gap-2">
            <span>{step === 5 ? 'Launch Control Plane' : 'Continue'}</span>
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
