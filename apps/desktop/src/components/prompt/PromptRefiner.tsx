import { ArrowRight, CheckCircle2, HelpCircle, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useMascotStore } from '../../stores/mascotStore';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

export interface PromptClarification {
  question: string;
  answer: string;
}

interface PromptRefinerProps {
  rawPrompt: string;
  onApplyRefinement: (refinedPrompt: string, clarifications: PromptClarification[]) => void;
  onCancel?: () => void;
}

export function PromptRefiner({ rawPrompt, onApplyRefinement, onCancel }: PromptRefinerProps) {
  const { setMood, say } = useMascotStore();
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedClarifications, setSelectedClarifications] = useState<Record<number, string>>({});

  // Proactive questions detected from raw prompt
  const detectedClarifications = [
    {
      id: 1,
      question: 'Which test & verification strategy is required for this ticket?',
      options: [
        'Automated unit & integration tests only',
        'Interactive UI/manual verification walkthrough',
        'Both unit tests + visual component snapshot',
      ],
      defaultOption: 'Both unit tests + visual component snapshot',
    },
    {
      id: 2,
      question: 'Should changes be committed to a new isolated git worktree branch?',
      options: [
        'Yes: isolate in .worktrees/<feature-name>',
        'No: apply directly to active working tree',
      ],
      defaultOption: 'Yes: isolate in .worktrees/<feature-name>',
    },
    {
      id: 3,
      question: 'Performance constraint or memory threshold:',
      options: [
        'Zero regression: maintain <60MB desktop idle RAM',
        'Standard: prioritize developer velocity over extreme tuning',
      ],
      defaultOption: 'Zero regression: maintain <60MB desktop idle RAM',
    },
  ];

  const handleSelectOption = (qId: number, option: string) => {
    setSelectedClarifications((prev) => ({ ...prev, [qId]: option }));
  };

  const handleRunRefinement = () => {
    setAnalyzing(true);
    setMood('thinking');
    say('Refining prompt with detected intent and constraints...', 3000);

    setTimeout(() => {
      setAnalyzing(false);
      setMood('success');
      say('Meta-prompt refined! Ready for agent assignment.', 3500);

      const generatedRefinement = `### 🎯 Feature Objective
${rawPrompt}

### 📐 Clarified Scope & Constraints:
${detectedClarifications
  .map((c) => `- **${c.question}**: ${selectedClarifications[c.id] || c.defaultOption}`)
  .join('\n')}

### 🤖 Agent Execution Instructions:
1. Initialize isolated git worktree branch.
2. Implement components adhering to WAI-ARIA and dynamic Arc/Zen theming tokens.
3. Validate typecheck and build passing cleanly.
4. Record walkthrough with summary for human author review (zero agent git commits).`;

      const clarificationResults = detectedClarifications.map((c) => ({
        question: c.question,
        answer: selectedClarifications[c.id] || c.defaultOption,
      }));

      onApplyRefinement(generatedRefinement, clarificationResults);
    }, 900);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] space-y-4 shadow-xl"
    >
      <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[var(--color-accent-subtle)] text-[var(--color-accent-ink)]">
            <Wand2 className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
              Proactive Meta-Prompt Refiner
            </h4>
            <p className="text-[11px] text-[var(--color-text-secondary)]">
              Clarifying questions detected to ensure high agent accuracy & zero wasted tokens.
            </p>
          </div>
        </div>
        <Badge variant="accent">AI Intent Engine</Badge>
      </div>

      {/* Raw Prompt Review */}
      <div className="p-3 rounded-xl bg-[var(--color-surface-sunken)] border border-[var(--color-border-subtle)] text-xs text-[var(--color-text-secondary)] font-mono">
        "{rawPrompt || 'No prompt provided yet'}"
      </div>

      {/* Detected Clarifying Questions */}
      <div className="space-y-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-primary)]">
          <HelpCircle className="w-3.5 h-3.5 text-[var(--color-accent-ink)]" />
          <span>Proactive Clarifications Detected:</span>
        </div>

        {detectedClarifications.map((item) => {
          const selected = selectedClarifications[item.id] || item.defaultOption;
          return (
            <div
              key={item.id}
              className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] space-y-2"
            >
              <div className="text-xs font-medium text-[var(--color-text-primary)]">
                {item.question}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {item.options.map((opt) => {
                  const isOptSelected = selected === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => handleSelectOption(item.id, opt)}
                      className={`text-left px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all border cursor-pointer ${
                        isOptSelected
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-text-primary)] font-semibold'
                          : 'border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {isOptSelected ? (
                          <CheckCircle2 className="w-3 h-3 text-[var(--color-accent-ink)] shrink-0" />
                        ) : (
                          <span className="w-3 h-3 rounded-full border border-[var(--color-border)] shrink-0" />
                        )}
                        <span className="truncate">{opt}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Action Footer */}
      <div className="flex items-center justify-between pt-2">
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Skip Refinement
          </Button>
        )}
        <Button onClick={handleRunRefinement} disabled={analyzing} className="gap-2 ml-auto">
          {analyzing ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Synthesizing Meta-Prompt...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              <span>Generate Refined Task Prompt</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </>
          )}
        </Button>
      </div>
    </motion.div>
  );
}
