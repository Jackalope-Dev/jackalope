import type { ReactNode } from 'react';
import './workspace-layout.css';

export function WorkspaceSectionHeading({
  title,
  description,
  action,
  titleId,
  level = 2,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  titleId?: string;
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <header className="workspace-section-header">
      <div>
        <Heading id={titleId} tabIndex={titleId ? -1 : undefined}>
          {title}
        </Heading>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
