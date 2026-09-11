import { type AriaAttributes, cloneElement, type ReactElement, type ReactNode, useId } from 'react';
import { cn } from '../../lib/utils';
import './shared-controls.css';

type FieldControl = AriaAttributes & { id?: string };

export function FormField({
  label,
  description,
  error,
  children,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  children: ReactElement<FieldControl>;
  className?: string;
}) {
  const generatedId = useId();
  const id = children.props.id ?? generatedId;
  const describedBy =
    [
      children.props['aria-describedby'],
      description ? `${id}-description` : undefined,
      error ? `${id}-error` : undefined,
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div className={cn('form-field', className)}>
      <label htmlFor={id}>{label}</label>
      {description && (
        <p id={`${id}-description`} className="form-field-description">
          {description}
        </p>
      )}
      {cloneElement(children, {
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : children.props['aria-invalid'],
      })}
      {error && (
        <p id={`${id}-error`} className="form-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
