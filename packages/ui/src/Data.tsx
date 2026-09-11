import { type ComponentPropsWithoutRef, Fragment, type ReactNode } from 'react';
import { cn } from './utils';
import './data.css';
export function DefinitionList({
  items,
  className,
}: {
  items: readonly { label: string; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn('ui-definition-list', className)}>
      {items.map(({ label, value }) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
export function Stat({
  label,
  value,
  description,
  action,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('ui-stat', className)}>
      <div className="ui-stat-label">{label}</div>
      <strong className="ui-stat-value">{value}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function Table({
  label,
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<'table'> & { label: string }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll overflowing tables.
    <section className="ui-table-scroll" tabIndex={0} aria-label={label}>
      <table {...props} className={cn('ui-table', className)}>
        <caption className="ui-sr-only">{label}</caption>
        {children}
      </table>
    </section>
  );
}
