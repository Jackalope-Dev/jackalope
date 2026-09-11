import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import { Check, FileText, Layers } from 'lucide-react';
import { VETTED_SKILLS } from '../../lib/skills/catalog';
import { Setting } from '../settings/Setting';
import { Switch } from '../ui/Switch';
import { CodeSurface } from './CodeSurface';
import './task-experience.css';

export function TaskContextPanel({
  selected,
  suggested,
  onToggle,
  instructions,
  prompt,
  embedded = false,
  automatic,
  onAutomaticChange,
}: {
  selected: string[];
  suggested: string[];
  onToggle: (id: string) => void;
  instructions?: string;
  prompt: string;
  embedded?: boolean;
  automatic?: boolean;
  onAutomaticChange?: (automatic: boolean) => void;
}) {
  const active = VETTED_SKILLS.filter((skill) => selected.includes(skill.id));
  const Container = embedded ? 'section' : 'details';
  const Heading = embedded ? 'div' : 'summary';
  return (
    <Container className="task-context-panel">
      <Heading className="task-experience-summary">
        <Layers size={18} aria-hidden="true" />
        <span>Task context</span>
        <span className="task-experience-meta">
          {active.length} {active.length === 1 ? 'guideline' : 'guidelines'}
          {instructions ? ' · Project instructions' : ''}
        </span>
      </Heading>
      <div className="task-context-body">
        {onAutomaticChange && (
          <Setting
            title="Choose guidelines automatically"
            description={
              automatic
                ? 'Uses project defaults, including prompt matching when enabled. Changing a guideline creates a task override.'
                : 'This task keeps your selection. Turn on automatic selection to use project defaults again.'
            }
          >
            <Switch
              label="Choose task guidelines automatically"
              checked={automatic === true}
              onCheckedChange={onAutomaticChange}
            />
          </Setting>
        )}
        <div className="task-context-guidelines">
          {VETTED_SKILLS.map((skill) => {
            const included = selected.includes(skill.id);
            return (
              <div
                key={skill.id}
                className="task-context-guideline"
                data-selected={included || undefined}
              >
                <button
                  type="button"
                  aria-pressed={included}
                  onClick={() => onToggle(skill.id)}
                  aria-label={`${included ? 'Remove' : 'Include'} ${skill.shortLabel}`}
                >
                  <span className="task-context-check">{included && <Check size={14} />}</span>
                  <span>{skill.shortLabel}</span>
                  {!included && suggested.includes(skill.id) && (
                    <span className="task-context-suggestion">Suggested</span>
                  )}
                </button>
                <Disclosure>
                  <DisclosureSummary aria-label={`Read ${skill.shortLabel} guidelines`}>
                    Read guidelines
                  </DisclosureSummary>
                  <p>{skill.description}</p>
                  <ul>
                    {skill.guidelines.map((rule) => (
                      <li key={rule}>{rule}</li>
                    ))}
                  </ul>
                </Disclosure>
              </div>
            );
          })}
        </div>
        {instructions && (
          <Disclosure className="task-context-instructions">
            <DisclosureSummary>
              <FileText size={16} aria-hidden="true" />
              Project instructions<span className="task-experience-meta">Included</span>
            </DisclosureSummary>

            <CodeSurface label="Project instructions">{instructions}</CodeSurface>
          </Disclosure>
        )}
        <Disclosure className="task-context-instructions">
          <DisclosureSummary>
            <FileText size={16} aria-hidden="true" />
            Full task prompt
          </DisclosureSummary>
          {prompt ? (
            <CodeSurface label="Full task prompt">{prompt}</CodeSurface>
          ) : (
            <p className="task-experience-muted">Describe your task to preview the prompt.</p>
          )}
        </Disclosure>
      </div>
    </Container>
  );
}
