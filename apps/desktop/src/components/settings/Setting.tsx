import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import './setting.css';

export function SettingGroup({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('settings-group', className)} {...props} />;
}

export function Setting({
  title,
  description,
  children,
  controlId,
  descriptionId,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  controlId?: string;
  descriptionId?: string;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-info">
        {controlId ? (
          <label htmlFor={controlId} className="settings-row-label">
            {title}
          </label>
        ) : (
          <div className="settings-row-label">{title}</div>
        )}
        {description && (
          <p id={descriptionId} className="settings-row-description">
            {description}
          </p>
        )}
      </div>
      {children && <div className="settings-control-wrapper">{children}</div>}
    </div>
  );
}
