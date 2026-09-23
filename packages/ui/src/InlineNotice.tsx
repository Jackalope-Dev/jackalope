import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { type ComponentPropsWithoutRef, forwardRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { cn } from './utils';
import './styles.css';

const icons = { error: CircleAlert, warning: TriangleAlert, success: CircleCheck, info: Info };
export const InlineNotice = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<'div'> & { tone?: keyof typeof icons; action?: ReactNode }
>(function InlineNotice({ tone = 'info', action, children, className, role, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn('inline-notice', className)}
      data-tone={tone}
      role={role ?? (tone === 'error' ? 'alert' : tone === 'success' ? 'status' : undefined)}
      {...props}
    >
      <Icon icon={icons[tone]} size={20} />
      <div className="inline-notice-content">{children}</div>
      {action && <div className="inline-notice-action">{action}</div>}
    </div>
  );
});
