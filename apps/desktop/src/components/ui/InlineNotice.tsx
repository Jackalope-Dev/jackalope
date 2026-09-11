import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { type ComponentPropsWithoutRef, forwardRef, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import './shared-controls.css';

const icons = { error: CircleAlert, warning: TriangleAlert, success: CircleCheck, info: Info };
export const InlineNotice = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<'div'> & { tone?: keyof typeof icons; action?: ReactNode }
>(function InlineNotice({ tone = 'info', action, children, className, role, ...props }, ref) {
  const Icon = icons[tone];
  return (
    <div
      ref={ref}
      className={cn('inline-notice', className)}
      data-tone={tone}
      role={role ?? (tone === 'error' ? 'alert' : tone === 'success' ? 'status' : undefined)}
      {...props}
    >
      <Icon size={18} aria-hidden="true" />
      <div className="inline-notice-content">{children}</div>
      {action && <div className="inline-notice-action">{action}</div>}
    </div>
  );
});
