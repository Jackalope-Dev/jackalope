import { Checkbox } from '@jackalope/ui';
import { FolderGit2 } from 'lucide-react';
import {
  candidateDetail,
  lastActivity,
  type RepositoryCandidate,
} from '../../lib/project-discovery';
import './repository-choices.css';

/** Repositories to add as projects, each with why it is listed and a checkbox. */
export function RepositoryChoices({
  candidates,
  selected,
  disabled,
  label,
  onToggle,
}: {
  candidates: RepositoryCandidate[];
  selected: string[];
  disabled?: boolean;
  label: string;
  onToggle: (path: string, on: boolean) => void;
}) {
  return (
    <fieldset className="repository-choices">
      <legend className="sr-only">{label}</legend>
      {candidates.map((candidate) => {
        const last = lastActivity(candidate);
        const detail = candidateDetail(candidate);
        return (
          <label key={candidate.path} className="repository-choice">
            <Checkbox
              checked={selected.includes(candidate.path)}
              disabled={disabled}
              onChange={(event) => onToggle(candidate.path, event.target.checked)}
            />
            <FolderGit2 size={16} aria-hidden="true" />
            <span className="repository-choice-name">
              <strong>{candidate.name}</strong>
              <span title={candidate.path}>{candidate.path}</span>
            </span>
            <span className="repository-choice-meta">
              {detail.map((part) => (
                <span key={part}>{part}</span>
              ))}
              {last && (
                <time dateTime={last.toISOString()} title={last.toLocaleString()}>
                  {last.toLocaleDateString(undefined, { dateStyle: 'medium' })}
                </time>
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
