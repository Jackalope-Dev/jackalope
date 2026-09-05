import { ArrowRight, CheckCircle2, FolderGit2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useMascotStore } from '../../stores/mascotStore';
import { useThemeStore } from '../../stores/themeStore';
import { JackalopeMascot } from '../mascot/JackalopeMascot';
import { ThemeEditor } from '../theme/ThemeEditor';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

interface OnboardingFlowProps {
  onComplete: () => void;
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<number>(1);
  const { currentTheme, setTheme } = useThemeStore();
  const { say, setMood } = useMascotStore();

  const [repoPath, setRepoPath] = useState('c:/Users/developer/Desktop/jackalope');
  const [selectedAgent, setSelectedAgent] = useState<'claude' | 'aider' | 'ollama' | 'antigravity'>(
    'claude',
  );

  const handleNext = () => {
    if (step === 1) {
      say('Find a color that feels like your space.', 4000);
      setMood('idle');
      setStep(2);
    } else if (step === 2) {
      say('Choose the agent you want to work with.', 4000);
      setMood('thinking');
      setStep(3);
    } else if (step === 3) {
      say('Bring a project you want to work on.', 4000);
      setMood('idle');
      setStep(4);
    } else if (step === 4) {
      say('Ready for your first idea.', 3000);
      setMood('success');
      setStep(5);
    } else {
      setMood('idle');
      onComplete();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-shell)] p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-xl max-h-[calc(100dvh-2rem)] rounded-3xl bg-[var(--color-bg)] shadow-[var(--shadow-pop)] overflow-y-auto flex flex-col"
      >
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)]/50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
              Welcome to Jackalope
            </span>
          </div>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                aria-hidden="true"
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
        <div className="px-10 py-8 flex flex-col items-center text-center">
          {/* Animated Mascot Anchor */}
          <div className="mb-6 flex justify-center">
            <JackalopeMascot
              size={step === 1 || step === 5 ? 'lg' : 'sm'}
              showBubble={false}
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
                  A little room for your next big idea.
                </h2>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  Bring your project, give an agent a direction, and follow the work from first
                  thought to final review.
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
                    Make yourself at home.
                  </h3>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                    Find a color that feels like your space. You can change it anytime.
                  </p>
                </div>

                <div className="text-left pt-3">
                  <ThemeEditor value={currentTheme} onChange={setTheme} />
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
                    Choose a collaborator.
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
                      onClick={() =>
                        setSelectedAgent(ag.id as 'claude' | 'aider' | 'ollama' | 'antigravity')
                      }
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
                          <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-accent-ink)]" />
                        )}
                      </div>
                      <span className="text-xs text-[var(--color-text-secondary)]">{ag.desc}</span>
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
                    Bring your project.
                  </h3>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                    Isolated git worktrees will be spawned directly from this root.
                  </p>
                </div>

                <div className="text-left space-y-2 pt-1">
                  <label
                    htmlFor="onboarding-repo-path"
                    className="text-xs font-medium text-[var(--color-text-secondary)]"
                  >
                    Local Git Repository Path
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="onboarding-repo-path"
                      value={repoPath}
                      onChange={(e) => setRepoPath(e.target.value)}
                      className="font-mono text-xs"
                    />
                    <Button variant="secondary" size="icon" title="Browse repository">
                      <FolderGit2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <span className="text-xs text-[var(--color-text-muted)] block">
                    Use the path to a local Git repository.
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
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 text-[var(--color-success)] text-xs font-semibold border border-emerald-500/20">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Setup complete</span>
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
                  Ready when you are.
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
            <span>{step === 5 ? 'Open workspace' : 'Continue'}</span>
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
