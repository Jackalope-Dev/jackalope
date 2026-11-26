import { LoaderCircle } from 'lucide-react';
import { ThinkingOrb, type ThinkingOrbState } from './ThinkingOrb';
import './loading-state.css';

export function LoadingState({
  label,
  compact = false,
  orb,
}: {
  label: string;
  compact?: boolean;
  /** An agent is behind the wait: show what it is doing instead of a generic spinner. */
  orb?: ThinkingOrbState;
}) {
  return (
    <div
      className={`workspace-loading${compact ? ' workspace-loading--compact' : ''}`}
      role="status"
    >
      <div className="workspace-loading-label">
        {orb ? (
          <ThinkingOrb state={orb} size={20} aria-hidden="true" />
        ) : (
          <LoaderCircle className="workspace-loading-spinner" size={18} aria-hidden="true" />
        )}
        <span>{label}</span>
      </div>
      {!compact && (
        <div className="workspace-loading-skeleton" aria-hidden="true">
          {[0, 1, 2].map((row) => (
            <div className="workspace-loading-row" key={row}>
              <span className="workspace-loading-icon" />
              <div>
                <span className="workspace-loading-line" />
                <span className="workspace-loading-line workspace-loading-line-short" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
