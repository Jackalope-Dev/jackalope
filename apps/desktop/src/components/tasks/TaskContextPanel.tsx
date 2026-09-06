import { Check, FileText, Layers } from 'lucide-react';
import { VETTED_SKILLS } from '../../lib/skills/catalog';
import { CodeSurface } from './CodeSurface';
import './task-experience.css';

export function TaskContextPanel({
  selected,
  suggested,
  onToggle,
  instructions,
  prompt,
}: {
  selected: string[];
  suggested: string[];
  onToggle: (id: string) => void;
  instructions?: string;
  prompt: string;
}) {
  const active = VETTED_SKILLS.filter((skill) => selected.includes(skill.id));
  return (
    <details className="task-context-panel">
      <summary className="task-experience-summary">
        <Layers size={18} aria-hidden="true" />
        <span>Task context</span>
        <span className="task-experience-meta">
          {active.length} {active.length === 1 ? 'guideline' : 'guidelines'}
          {instructions ? ' · Project instructions' : ''}
        </span>
      </summary>
      <div className="task-context-body">
        <p className="task-experience-muted">
          Choose the guidance to include. Open a guideline to read exactly what it adds.
        </p>
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
            <p className="task-experience-muted">Managed in Project settings.</p>
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
    </details>
  );
}
