import * as Primitive from '@radix-ui/react-popover';
import { type ComponentPropsWithoutRef, type ComponentRef, forwardRef } from 'react';
import { cn } from './utils';
import './overlays.css';

export { Anchor, Arrow, Close, Portal, Root, Trigger } from '@radix-ui/react-popover';
export const Content = forwardRef<
  ComponentRef<typeof Primitive.Content>,
  ComponentPropsWithoutRef<typeof Primitive.Content>
>(({ className, ...props }, ref) => (
  <Primitive.Content
    ref={ref}
    sideOffset={6}
    collisionPadding={12}
    {...props}
    className={cn('ui-popover', className)}
  />
));
Content.displayName = 'Content';
