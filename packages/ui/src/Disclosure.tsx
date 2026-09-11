import { ChevronDown } from 'lucide-react';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';
import { Icon } from './Icon';
import { cn } from './utils';
import './disclosure.css';

export const Disclosure = forwardRef<HTMLDetailsElement, ComponentPropsWithoutRef<'details'>>(
  ({ className, ...props }, ref) => (
    <details {...props} ref={ref} className={cn('ui-disclosure', className)} />
  ),
);
Disclosure.displayName = 'Disclosure';
export const DisclosureSummary = forwardRef<HTMLElement, ComponentPropsWithoutRef<'summary'>>(
  ({ className, children, ...props }, ref) => (
    <summary {...props} ref={ref} className={cn('ui-disclosure-summary', className)}>
      {children}
      <Icon icon={ChevronDown} className="ui-disclosure-indicator" />
    </summary>
  ),
);
DisclosureSummary.displayName = 'DisclosureSummary';
export const DisclosureBody = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div {...props} ref={ref} className={cn('ui-disclosure-body', className)} />
  ),
);
DisclosureBody.displayName = 'DisclosureBody';
