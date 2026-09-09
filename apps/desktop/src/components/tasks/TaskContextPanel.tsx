import { Check, FileText, Layers } from 'lucide-react';
import { VETTED_SKILLS } from '../../lib/skills/catalog';
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
          <div className="mb-4">
            <Switch
              label="Choose task guidelines automatically"
              checked={automatic === true}
              onCheckedChange={onAutomaticChange}
            />
            <p className="task-muted mt-2">
              {automatic
                ? 'Uses project defaults and matches guidance to your prompt. Changing a guideline creates a task override.'
                : 'This task keeps your selection. Turn on automatic selection to use project defaults again.'}
            </p>
          </div>
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
                <details>
                  <summary aria-label={`Read ${skill.shortLabel} guidelines`}>
                    Read guidelines
                  </summary>
                  <p>{skill.description}</p>
                  <ul>
                    {skill.guidelines.map((rule) => (
                      <li key={rule}>{rule}</li>
                    ))}
                  </ul>
                </details>
              </div>
            );
          })}
        </div>
        {instructions && (
          <details className="task-context-instructions">
            <summary>
              <FileText size={16} aria-hidden="true" />
              Project instructions<span className="task-experience-meta">Included</span>
            </summary>

            <CodeSurface label="Project instructions">{instructions}</CodeSurface>
          </details>
        )}
        <details className="task-context-instructions">
          <summary>
            <FileText size={16} aria-hidden="true" />
            Full task prompt
          </summary>
          {prompt ? (
            <CodeSurface label="Full task prompt">{prompt}</CodeSurface>
          ) : (
            <p className="task-experience-muted">Describe your task to preview the prompt.</p>
          )}
        </details>
      </div>
    </Container>
  );
}
