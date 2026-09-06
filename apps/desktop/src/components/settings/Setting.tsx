import type { ReactNode } from 'react';
export function Setting({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-info">
        <div className="settings-row-label">{title}</div>
        <p className="settings-row-description">{description}</p>
      </div>
      {children && <div className="settings-control-wrapper">{children}</div>}
    </div>
  );
}
