import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from './utils';
import './setting.css';

export function SettingGroup({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={cn('settings-group', className)} />;
}
export type SettingRowProps = Omit<ComponentPropsWithoutRef<'div'>, 'title'> & {
  title: ReactNode;
  description?: ReactNode;
  controlId?: string;
  descriptionId?: string;
};
export function SettingRow({
  title,
  description,
  children,
  controlId,
  descriptionId,
  className,
  ...props
}: SettingRowProps) {
  return (
    <div {...props} className={cn('settings-row', className)}>
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
