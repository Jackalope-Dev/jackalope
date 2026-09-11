import type { ComponentPropsWithoutRef, Ref } from 'react';
import { cn } from '../../lib/utils';
import { Button } from './button';
import './shared-controls.css';

export function WorkspaceToolbar({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('workspace-toolbar', className)} {...props} />;
}

export function FilterGroup<T extends string>({
  label,
  items,
  value,
  onChange,
  activeRef,
}: {
  label: string;
  items: readonly { id: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  activeRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <fieldset className="filter-group">
      <legend className="sr-only">{label}</legend>
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
