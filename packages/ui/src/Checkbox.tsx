import { forwardRef, type InputHTMLAttributes, useCallback } from 'react';
import { cn } from './utils';
import './controls.css';
export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  indeterminate?: boolean;
};
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, indeterminate, ...props }, ref) => {
    const inputRef = useCallback(
      (element: HTMLInputElement | null) => {
        if (element) element.indeterminate = !!indeterminate;
        if (typeof ref === 'function') return ref(element);
        if (ref) ref.current = element;
      },
      [indeterminate, ref],
    );
    return (
      <input {...props} type="checkbox" className={cn('ui-checkbox', className)} ref={inputRef} />
    );
  },
);
Checkbox.displayName = 'Checkbox';
