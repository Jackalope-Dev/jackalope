import { Check } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './utils';
import './choice.css';

/**
 * One option people pick from a list: a bordered row with a title, an optional description
 * and a radio indicator. Selection is a tinted fill plus the filled indicator, so it never
 * relies on colour alone. Rows that wrap a native checkbox or radio can use the `ui-choice`
 * classes directly; the selected state follows `:has(input:checked)`.
 */
export function Choice({
  selected,
  title,
  description,
  leading,
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> & {
  selected: boolean;
  title: ReactNode;
  description?: ReactNode;
  /** Shown before the text, such as a provider mark. */
  leading?: ReactNode;
}) {
  return (
    <button type="button" aria-pressed={selected} className={cn('ui-choice', className)} {...props}>
      {leading}
      <span className="ui-choice-body">
        <span className="ui-choice-title">{title}</span>
        {description && <span className="ui-choice-description">{description}</span>}
      </span>
      <span className="ui-choice-indicator" aria-hidden="true">
        {selected && <Check size={12} strokeWidth={3} />}
      </span>
    </button>
  );
}
