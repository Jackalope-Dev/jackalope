import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import './states.css';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  level = 2,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  level?: 1 | 2 | 3;
}) {
  const Heading = `h${level}` as const;
  return (
    <div className="empty-state">
      {Icon && (
        <span className="empty-state-icon">
          <Icon size={28} aria-hidden="true" />
        </span>
      )}
      <div>
        <Heading className="ui-state-title">{title}</Heading>
        {description && <p className="ui-state-description">{description}</p>}
        {action && <div className="empty-state-action">{action}</div>}
      </div>
    </div>
  );
}
