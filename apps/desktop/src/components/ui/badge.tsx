import type * as React from 'react';
import { cn } from '../../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'accent' | 'outline' | 'success' | 'warning';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        variant === 'default' &&
          'border-transparent bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] border border-[var(--color-border)]',
        variant === 'accent' &&
          'bg-[var(--color-accent-subtle)] text-[var(--color-accent-ink)] border border-[var(--color-accent)]/20',
        variant === 'outline' &&
          'text-[var(--color-text-primary)] border border-[var(--color-border)]',
        variant === 'success' && 'bg-emerald-500/15 text-[var(--color-success)] border border-emerald-500/30',
        variant === 'warning' && 'bg-amber-500/15 text-[var(--color-warning)] border border-amber-500/30',
        className,
      )}
      {...props}
    />
  );
}
