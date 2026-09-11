import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import { Button } from './Button';
import { cn } from './utils';
import './layout.css';
export function PageHeader({
  title,
  description,
  action,
  titleRef,
  icon,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  titleRef?: Ref<HTMLHeadingElement>;
  icon?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('ui-page-header', className)}>
      <div className="ui-page-identity">
        {icon}
        <div>
          {eyebrow && <div className="ui-eyebrow">{eyebrow}</div>}
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
export function SectionHeader({
  title,
  description,
  action,
  titleId,
  level = 2,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  titleId?: string;
  level?: 2 | 3;
  className?: string;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <header className={cn('ui-section-header', className)}>
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
export function Toolbar({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={cn('ui-toolbar', className)} />;
}
export function SegmentedControl<T extends string>({
  label,
  items,
  value,
  onChange,
  activeRef,
  className,
}: {
  label: string;
  items: readonly { id: T; label: ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  activeRef?: Ref<HTMLButtonElement>;
  className?: string;
}) {
  return (
    <fieldset className={cn('ui-segmented-control', className)}>
      <legend className="ui-sr-only">{label}</legend>
      {items.map((item) => (
        <Button
          key={item.id}
          ref={value === item.id ? activeRef : undefined}
          type="button"
          size="sm"
          variant={value === item.id ? 'secondary' : 'ghost'}
          aria-pressed={value === item.id}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </Button>
      ))}
    </fieldset>
  );
}
