import { type ButtonHTMLAttributes, forwardRef, useId } from 'react';
import { cn } from './utils';
import './controls.css';
export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  description?: string;
}
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, label, description, className, onClick, ...props }, ref) => {
    const id = useId();
    return (
      <>
        <button
          {...props}
          ref={ref}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={props['aria-label'] || label}
          aria-describedby={
            [props['aria-describedby'], description ? id : null].filter(Boolean).join(' ') ||
            undefined
          }
          className={cn('ui-switch', className)}
          onClick={(event) => {
            onClick?.(event);
            if (!event.defaultPrevented) onCheckedChange(!checked);
          }}
        >
          <span className="ui-switch-track">
            <span className="ui-switch-thumb" />
          </span>
        </button>
        {description && (
          <span id={id} className="ui-sr-only">
            {description}
          </span>
        )}
      </>
    );
  },
);
Switch.displayName = 'Switch';
