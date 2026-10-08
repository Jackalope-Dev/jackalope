import * as Primitive from '@radix-ui/react-tabs';
import { type ComponentPropsWithoutRef, type ComponentRef, forwardRef } from 'react';
import { useSegmentIndicator } from './useSegmentIndicator';
import { cn } from './utils';
import './segmented.css';
import './tabs.css';
export const Root = forwardRef<
  ComponentRef<typeof Primitive.Root>,
  ComponentPropsWithoutRef<typeof Primitive.Root>
>(({ className, ...props }, ref) => (
  <Primitive.Root ref={ref} {...props} className={cn('ui-tabs', className)} />
));
Root.displayName = 'Root';
const SegmentedList = forwardRef<
  ComponentRef<typeof Primitive.List>,
  ComponentPropsWithoutRef<typeof Primitive.List>
>(({ className, children, ...props }, ref) => {
  const track = useSegmentIndicator<ComponentRef<typeof Primitive.List>>(ref);
  return (
    <Primitive.List ref={track} {...props} className={cn('ui-segmented', className)}>
      <span className="ui-segmented-indicator" aria-hidden="true" />
      {children}
    </Primitive.List>
  );
});
SegmentedList.displayName = 'SegmentedList';
export const List = forwardRef<
  ComponentRef<typeof Primitive.List>,
  ComponentPropsWithoutRef<typeof Primitive.List> & {
    /** `segmented` draws the list as the shared segmented track used by view navigation. */
    appearance?: 'default' | 'segmented';
  }
>(({ className, appearance = 'default', ...props }, ref) =>
  appearance === 'segmented' ? (
    <SegmentedList ref={ref} {...props} className={className} />
  ) : (
    <Primitive.List ref={ref} {...props} className={cn('ui-tabs-list', className)} />
  ),
);
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
