import * as React from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]',
          // Variants
          variant === 'primary' &&
            'bg-[var(--color-accent)] text-black font-semibold hover:bg-[var(--color-accent-hover)] shadow-sm hover:shadow-[var(--shadow-pop)]',
          variant === 'secondary' &&
            'bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)]',
          variant === 'outline' &&
            'border border-[var(--color-border)] bg-transparent text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]',
          variant === 'ghost' &&
            'bg-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]',
          variant === 'danger' &&
            'bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25',
          // Sizes
          size === 'sm' && 'h-8 px-2.5 text-xs gap-1.5',
          size === 'md' && 'h-9 px-3.5 text-sm gap-2',
          size === 'lg' && 'h-11 px-5 text-base gap-2.5',
          size === 'icon' && 'h-9 w-9 p-0',
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
