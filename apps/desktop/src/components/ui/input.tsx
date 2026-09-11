import * as React from 'react';
import { cn } from '../../lib/utils';
import './shared-controls.css';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return <input type={type} className={cn('form-control', className)} ref={ref} {...props} />;
  },
);
Input.displayName = 'Input';
