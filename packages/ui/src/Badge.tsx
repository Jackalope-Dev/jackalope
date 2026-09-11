import type { HTMLAttributes } from 'react';
import { cn } from './utils';
import './controls.css';
export interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'accent' | 'outline' | 'success' | 'warning' | 'danger';
}
export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return <div {...props} className={cn('ui-badge', className)} data-variant={variant} />;
}
