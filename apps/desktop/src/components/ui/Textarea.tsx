import { type ComponentPropsWithoutRef, forwardRef } from 'react';
import { cn } from '../../lib/utils';
import './shared-controls.css';

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn('form-control form-control-multiline', className)}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
