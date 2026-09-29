import { cn, Tabs } from '@jackalope/ui';
import { type ComponentProps, forwardRef } from 'react';

const List = forwardRef<HTMLDivElement, ComponentProps<typeof Tabs.List>>(
  ({ className, ...props }, ref) => (
    <Tabs.List {...props} ref={ref} className={cn('workspace-tab-list', className)} />
  ),
);
const Trigger = forwardRef<HTMLButtonElement, ComponentProps<typeof Tabs.Trigger>>(
  ({ className, ...props }, ref) => (
    <Tabs.Trigger {...props} ref={ref} className={cn('workspace-nav-item', className)} />
  ),
);

export const WorkspaceTabs = { ...Tabs, List, Trigger };
