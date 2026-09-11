import type { ReactNode, Ref } from 'react';
import './workspace-layout.css';

export function WorkspaceHeading({
  title,
  description,
  action,
  titleRef,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  titleRef?: Ref<HTMLHeadingElement>;
  icon?: ReactNode;
}) {
  return (
    <header className="workspace-heading">
      <div className="workspace-heading-identity">
        {icon}
        <div>
          <h1 ref={titleRef} tabIndex={titleRef ? -1 : undefined}>
            {title}
          </h1>
          {description && <p>{description}</p>}
        </div>
      </div>
      {action}
    </header>
  );
}
