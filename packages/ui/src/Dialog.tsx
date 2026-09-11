import * as Primitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { type ComponentPropsWithoutRef, forwardRef, type ReactNode } from 'react';
import { IconButton } from './IconButton';
import { cn } from './utils';
import './styles.css';

export const DialogContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Primitive.Content> & {
    overlayClassName?: string;
    contained?: boolean;
  }
>(({ className, overlayClassName, contained, ...props }, ref) => (
  <Primitive.Portal>
    <Primitive.Overlay className={cn('ui-dialog-overlay task-dialog-overlay', overlayClassName)} />
    <Primitive.Content
      ref={ref}
      data-contained={contained || undefined}
      className={cn('ui-dialog task-dialog appearance-panel app-dialog', className)}
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
      <IconButton
        type="button"
        variant="ghost"
        className="app-dialog-close"
        label={label}
        disabled={disabled}
      >
        <X size={18} aria-hidden="true" />
      </IconButton>
    </Primitive.Close>
  );
}
