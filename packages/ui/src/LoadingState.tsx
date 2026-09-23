import { LoaderCircle } from 'lucide-react';
import './loading-state.css';

export function LoadingState({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div
      className={`workspace-loading${compact ? ' workspace-loading--compact' : ''}`}
      role="status"
    >
      <div className="workspace-loading-label">
        <LoaderCircle className="workspace-loading-spinner" size={18} aria-hidden="true" />
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
