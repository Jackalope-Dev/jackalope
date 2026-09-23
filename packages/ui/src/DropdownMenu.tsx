import * as Primitive from '@radix-ui/react-dropdown-menu';
import { type ComponentPropsWithoutRef, type ComponentRef, forwardRef } from 'react';
import { cn } from './utils';
import './overlays.css';

export {
  Arrow,
  Group,
  ItemIndicator,
  Portal,
  RadioGroup,
  Root,
  Sub,
  Trigger,
} from '@radix-ui/react-dropdown-menu';
export const Content = forwardRef<
  ComponentRef<typeof Primitive.Content>,
  ComponentPropsWithoutRef<typeof Primitive.Content>
>(({ className, ...props }, ref) => (
  <Primitive.Content
    ref={ref}
    sideOffset={6}
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
export const CheckboxItem = forwardRef<
  ComponentRef<typeof Primitive.CheckboxItem>,
  ComponentPropsWithoutRef<typeof Primitive.CheckboxItem>
>(({ className, ...props }, ref) => (
  <Primitive.CheckboxItem ref={ref} {...props} className={cn('ui-menu-item', className)} />
));
CheckboxItem.displayName = 'CheckboxItem';
export const RadioItem = forwardRef<
  ComponentRef<typeof Primitive.RadioItem>,
  ComponentPropsWithoutRef<typeof Primitive.RadioItem>
>(({ className, ...props }, ref) => (
  <Primitive.RadioItem ref={ref} {...props} className={cn('ui-menu-item', className)} />
));
RadioItem.displayName = 'RadioItem';
export const Label = forwardRef<
  ComponentRef<typeof Primitive.Label>,
  ComponentPropsWithoutRef<typeof Primitive.Label>
>(({ className, ...props }, ref) => (
  <Primitive.Label ref={ref} {...props} className={cn('ui-menu-label', className)} />
));
Label.displayName = 'Label';
export const Separator = forwardRef<
  ComponentRef<typeof Primitive.Separator>,
  ComponentPropsWithoutRef<typeof Primitive.Separator>
>(({ className, ...props }, ref) => (
  <Primitive.Separator ref={ref} {...props} className={cn('ui-menu-separator', className)} />
));
Separator.displayName = 'Separator';
export const SubContent = forwardRef<
  ComponentRef<typeof Primitive.SubContent>,
  ComponentPropsWithoutRef<typeof Primitive.SubContent>
>(({ className, ...props }, ref) => (
  <Primitive.SubContent
    ref={ref}
    sideOffset={6}
    collisionPadding={12}
    {...props}
    className={cn('ui-menu', className)}
  />
));
SubContent.displayName = 'SubContent';
export const SubTrigger = forwardRef<
  ComponentRef<typeof Primitive.SubTrigger>,
  ComponentPropsWithoutRef<typeof Primitive.SubTrigger>
>(({ className, ...props }, ref) => (
  <Primitive.SubTrigger ref={ref} {...props} className={cn('ui-menu-item', className)} />
));
SubTrigger.displayName = 'SubTrigger';
