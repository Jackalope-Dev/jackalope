import * as Primitive from '@radix-ui/react-context-menu';
import { type ComponentPropsWithoutRef, type ComponentRef, forwardRef } from 'react';
import { cn } from './utils';
import './overlays.css';

/** A right-click menu with the same surface, rows and motion as DropdownMenu. */
export { Group, Portal, Root, Trigger } from '@radix-ui/react-context-menu';
export const Content = forwardRef<
  ComponentRef<typeof Primitive.Content>,
  ComponentPropsWithoutRef<typeof Primitive.Content>
>(({ className, ...props }, ref) => (
  <Primitive.Content
    ref={ref}
    collisionPadding={12}
    {...props}
    className={cn('ui-menu', className)}
  />
));
Content.displayName = 'Content';
export const Item = forwardRef<
  ComponentRef<typeof Primitive.Item>,
  ComponentPropsWithoutRef<typeof Primitive.Item>
>(({ className, ...props }, ref) => (
  <Primitive.Item ref={ref} {...props} className={cn('ui-menu-item', className)} />
));
Item.displayName = 'Item';
export const Separator = forwardRef<
  ComponentRef<typeof Primitive.Separator>,
  ComponentPropsWithoutRef<typeof Primitive.Separator>
>(({ className, ...props }, ref) => (
  <Primitive.Separator ref={ref} {...props} className={cn('ui-menu-separator', className)} />
));
Separator.displayName = 'Separator';
