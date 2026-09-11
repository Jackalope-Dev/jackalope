import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';
export function ErrorState({
  title = 'Something went wrong',
  description,
  action,
  level,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  level?: 1 | 2 | 3;
}) {
  return (
    <div role="alert">
      <EmptyState
        icon={AlertCircle}
        title={title}
        description={description}
        action={action}
        level={level}
      />
    </div>
  );
}
