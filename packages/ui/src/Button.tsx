import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react';
import { LoadingIcon } from './Icon';
import { cn } from './utils';
import './button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
  loadingLabel?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading,
      loadingLabel = 'Working…',
      disabled,
      children,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      className={cn('ui-button', className)}
      data-variant={variant}
      data-size={size}
      data-loading={loading}
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || props['aria-busy']}
    >
      {loading !== undefined ? (
        <span className="ui-button-labels">
          <span className="ui-button-content" aria-hidden={loading || undefined}>
            {children}
          </span>
          <span className="ui-button-pending" aria-hidden={!loading || undefined}>
            <LoadingIcon />
            {size === 'icon' ? <span className="ui-sr-only">{loadingLabel}</span> : loadingLabel}
          </span>
        </span>
      ) : (
        children
      )}
    </button>
  ),
);
Button.displayName = 'Button';
