import * as Primitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { type ComponentPropsWithoutRef, forwardRef, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Button } from './button';
import './shared-controls.css';

export const DialogContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Primitive.Content> & {
    overlayClassName?: string;
    contained?: boolean;
  }
>(({ className, overlayClassName, contained, ...props }, ref) => (
  <Primitive.Portal>
    <Primitive.Overlay className={cn('task-dialog-overlay', overlayClassName)} />
    <Primitive.Content
      ref={ref}
      data-contained={contained || undefined}
      className={cn('task-dialog appearance-panel app-dialog', className)}
      {...props}
    />
  </Primitive.Portal>
));
DialogContent.displayName = 'DialogContent';

export function DialogHeader({
  title,
  description,
}: {
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <header className="app-dialog-header">
      <Primitive.Title>{title}</Primitive.Title>
      {description && <Primitive.Description>{description}</Primitive.Description>}
    </header>
  );
}

export function DialogFooter({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('app-dialog-footer', className)} {...props} />;
}

export function DialogCloseButton({
  label = 'Close dialog',
  disabled,
}: {
  label?: string;
  disabled?: boolean;
}) {
  return (
    <Primitive.Close asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="app-dialog-close"
        aria-label={label}
        disabled={disabled}
      >
        <X size={18} aria-hidden="true" />
      </Button>
    </Primitive.Close>
  );
}
