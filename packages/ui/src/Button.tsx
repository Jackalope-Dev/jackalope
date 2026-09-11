import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from './utils';
import './button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      className={cn('ui-button', className)}
      data-variant={variant}
      data-size={size}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
