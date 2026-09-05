import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <Icon size={28} aria-hidden="true" />
      </span>
      <div>
        <h2>{title}</h2>
        <p className="task-muted">{description}</p>
        {action && <div className="empty-state-action">{action}</div>}
      </div>
    </div>
  );
}
