import * as Primitive from '@radix-ui/react-tabs';
import { type ComponentPropsWithoutRef, type ComponentRef, forwardRef } from 'react';
import { cn } from './utils';
import './tabs.css';
export const Root = forwardRef<
  ComponentRef<typeof Primitive.Root>,
  ComponentPropsWithoutRef<typeof Primitive.Root>
>(({ className, ...props }, ref) => (
  <Primitive.Root ref={ref} {...props} className={cn('ui-tabs', className)} />
));
Root.displayName = 'Root';
export const List = forwardRef<
  ComponentRef<typeof Primitive.List>,
  ComponentPropsWithoutRef<typeof Primitive.List>
>(({ className, ...props }, ref) => (
  <Primitive.List ref={ref} {...props} className={cn('ui-tabs-list', className)} />
));
List.displayName = 'List';
export const Trigger = forwardRef<
  ComponentRef<typeof Primitive.Trigger>,
  ComponentPropsWithoutRef<typeof Primitive.Trigger>
>(({ className, ...props }, ref) => (
  <Primitive.Trigger ref={ref} {...props} className={cn('ui-tabs-trigger', className)} />
));
Trigger.displayName = 'Trigger';
export const Content = forwardRef<
  ComponentRef<typeof Primitive.Content>,
  ComponentPropsWithoutRef<typeof Primitive.Content>
>(({ className, ...props }, ref) => (
  <Primitive.Content ref={ref} {...props} className={cn('ui-tabs-content', className)} />
));
Content.displayName = 'Content';
