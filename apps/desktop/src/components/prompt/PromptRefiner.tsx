import {
  ArrowRight,
  Bug,
  Check,
  CheckCircle2,
  GitBranch,
  Globe,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Wand2,
  Zap,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import {
  detectSkillsFromPrompt,
  type SkillCategory,
  VETTED_SKILLS,
} from '../../lib/skills/catalog.ts';
import { assemblePrompt } from '../../lib/skills/context-assembler.ts';
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

const CATEGORY_ICONS: Record<SkillCategory, React.ComponentType<{ className?: string }>> = {
  debugging: Bug,
  feature: Sparkles,
  refactor: RefreshCw,
  testing: CheckCircle2,
  security: ShieldAlert,
  performance: Zap,
  git: GitBranch,
  browser: Globe,
};

export function PromptRefiner({ rawPrompt, onApplyRefinement, onCancel }: PromptRefinerProps) {
  const { setMood, say } = useMascotStore();

  // Initial detection from raw prompt
  const initialMatches = useMemo(() => detectSkillsFromPrompt(rawPrompt), [rawPrompt]);

  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(() =>
    initialMatches.length ? initialMatches.map((s) => s.id) : ['feature-scaffolding'],
  );
  const [executionMode, setExecutionMode] = useState<'isolated' | 'current'>('isolated');
  const [showPreview, setShowPreview] = useState(true);

  // Update selected skills if rawPrompt changes externally and no manual edits were made
  useEffect(() => {
    if (initialMatches.length) {
      setSelectedSkillIds(initialMatches.map((s) => s.id));
    }
  }, [initialMatches]);

  const toggleSkill = (skillId: string) => {
    setSelectedSkillIds((prev) =>
      prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId],
    );
  };

  const { assembledPrompt, activeSkillCount } = useMemo(() => {
    return assemblePrompt({
      rawPrompt,
      selectedSkillIds,
      executionMode,
    });
  }, [rawPrompt, selectedSkillIds, executionMode]);

  const handleApply = () => {
    setMood('success');
    say('Refined prompt applied with verified skill guidelines.', 3000);

    const activeSkills = VETTED_SKILLS.filter((s) => selectedSkillIds.includes(s.id));
    const clarifications: PromptClarification[] = [
      {
        question: 'Active Skill Guidelines',
        answer: activeSkills.map((s) => s.name).join(', ') || 'None',
      },
      {
        question: 'Git Execution Mode',
        answer:
          executionMode === 'isolated' ? 'Isolated git worktree branch' : 'Active working checkout',
      },
    ];

    onApplyRefinement(assembledPrompt, clarifications);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] space-y-4 shadow-xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[var(--color-accent-subtle)] text-[var(--color-accent-ink)]">
            <Wand2 className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
              Context & Skill Supplementation
            </h4>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Select vetted guidelines to enhance agent execution without altering your original
              intent.
            </p>
          </div>
        </div>
        <Badge variant="accent">Vetted Skills</Badge>
      </div>

      {/* Raw Prompt Anchor */}
      <div className="p-3 rounded-xl bg-[var(--color-surface-sunken)] border border-[var(--color-border-subtle)] text-xs text-[var(--color-text-secondary)] font-mono">
        <span className="font-semibold text-[var(--color-text-primary)]">Raw intent: </span>"
        {rawPrompt || 'No prompt provided yet'}"
      </div>

      {/* Skill Selection Grid */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold text-[var(--color-text-primary)]">
          <span>Applicable Vetted Skills ({activeSkillCount} active):</span>
          <span className="text-xs font-normal text-[var(--color-text-muted)]">
            Click to toggle
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {VETTED_SKILLS.map((skill) => {
            const isSelected = selectedSkillIds.includes(skill.id);
            const Icon = CATEGORY_ICONS[skill.category] || Sparkles;

            return (
              <button
                key={skill.id}
                type="button"
                onClick={() => toggleSkill(skill.id)}
                className={`text-left p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                  isSelected
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]/40 shadow-xs'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon
                      className={`w-3.5 h-3.5 ${
                        isSelected
                          ? 'text-[var(--color-accent-ink)]'
                          : 'text-[var(--color-text-muted)]'
                      }`}
                    />
                    <span
                      className={`text-xs font-medium ${
                        isSelected
                          ? 'text-[var(--color-text-primary)] font-semibold'
                          : 'text-[var(--color-text-secondary)]'
                      }`}
                    >
                      {skill.name}
                    </span>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${
                      isSelected
                        ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-[var(--color-accent-ink)]'
                        : 'border-[var(--color-border)]'
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>
                </div>
                <p className="text-xs text-[var(--color-text-muted)] line-clamp-2 leading-tight">
                  {skill.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Execution Mode Choice */}
      <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <GitBranch className="w-3.5 h-3.5 text-[var(--color-text-secondary)]" />
          <span className="font-medium text-[var(--color-text-primary)]">Execution isolation:</span>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setExecutionMode('isolated')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              executionMode === 'isolated'
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-text-primary)] font-semibold'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            New worktree
          </button>
          <button
            type="button"
            onClick={() => setExecutionMode('current')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              executionMode === 'current'
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-text-primary)] font-semibold'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            Current checkout
          </button>
        </div>
      </div>

      {/* Live Assembled Prompt Preview */}
      {showPreview && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
            <span className="font-semibold text-[var(--color-text-primary)]">
              Assembled Prompt Preview:
            </span>
            <span className="text-xs font-mono text-[var(--color-text-muted)]">
              {assembledPrompt.length} chars
            </span>
          </div>
          <pre className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] text-xs font-mono whitespace-pre-wrap text-[var(--color-text-primary)] leading-relaxed max-h-40 overflow-y-auto">
            {assembledPrompt || rawPrompt || '(No prompt provided)'}
          </pre>
        </div>
      )}

      {/* Action Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Skip / Keep Raw
          </Button>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={() => setShowPreview(!showPreview)}>
            {showPreview ? 'Hide preview' : 'Show preview'}
          </Button>
          <Button onClick={handleApply} className="gap-2">
            <span>Apply Refinement</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
