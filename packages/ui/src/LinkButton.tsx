import { ArrowUpRight } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from './utils';
import './link-button.css';

/**
 * An action that reads as a link inside text or beside buttons. It sizes to its text rather
 * than the control height, keeps an underline so it is not identified by colour alone, and
 * shows an arrow when it opens something outside the app.
 */
export function LinkButton({
  external = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { external?: boolean }) {
  return (
    <button type="button" className={cn('ui-link', className)} {...props}>
      {children}
      {external && <ArrowUpRight size={14} aria-hidden="true" className="ui-link-icon" />}
    </button>
  );
}
