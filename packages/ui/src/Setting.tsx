import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from './utils';
import './setting.css';

export type SettingGroupProps = Omit<ComponentPropsWithoutRef<'div'>, 'title'> & {
  /** Optional heading row, styled like a setting row so every card reads the same. */
  title?: ReactNode;
  description?: ReactNode;
  /** Control beside the heading, such as a switch or a primary action. */
  action?: ReactNode;
  /** `danger` outlines destructive settings. */
  tone?: 'default' | 'danger';
};

/** One rounded settings card. Consecutive cards keep a consistent gap. */
export function SettingGroup({
  title,
  description,
  action,
  tone = 'default',
  className,
  children,
  ...props
}: SettingGroupProps) {
  return (
    <div
      {...props}
      className={cn('settings-group', className)}
      data-tone={tone === 'danger' ? 'danger' : undefined}
    >
      {(title || description || action) && (
        <SettingRow
          className="settings-group-header"
          title={title ?? null}
          description={description}
        >
          {action}
        </SettingRow>
      )}
      {children}
    </div>
  );
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

/** Free-form content inside a card, such as a form, picker or list, with row padding. */
export function SettingBody({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={cn('settings-block', className)} />;
}

/** A card's footer buttons, aligned to the row padding. */
export function SettingActions({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={cn('settings-actions', className)} />;
}
