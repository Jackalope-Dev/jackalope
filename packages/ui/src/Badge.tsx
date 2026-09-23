import type { LucideIcon } from 'lucide-react';
import type { HTMLAttributes } from 'react';
import { Icon } from './Icon';
import { cn } from './utils';
import './controls.css';
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'accent' | 'outline' | 'success' | 'warning' | 'danger';
  appearance?: 'soft' | 'plain';
  icon?: LucideIcon;
}
export function Badge({
  className,
  variant = 'default',
  appearance = 'soft',
  icon,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      {...props}
      className={cn('ui-badge', className)}
      data-variant={variant}
      data-appearance={appearance}
    >
      {icon && <Icon icon={icon} />}
      {children}
    </span>
  );
}
