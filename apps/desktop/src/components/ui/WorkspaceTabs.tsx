import { Tabs } from '@jackalope/ui';
import { type ComponentProps, forwardRef } from 'react';

const List = forwardRef<HTMLDivElement, ComponentProps<typeof Tabs.List>>(
  ({ className, ...props }, ref) => (
    <Tabs.List
      {...props}
      ref={ref}
      className={['workspace-tab-list', className].filter(Boolean).join(' ')}
    />
  ),
);
const Trigger = forwardRef<HTMLButtonElement, ComponentProps<typeof Tabs.Trigger>>(
  ({ className, ...props }, ref) => (
    <Tabs.Trigger
      {...props}
      ref={ref}
      className={['workspace-nav-item', className].filter(Boolean).join(' ')}
    />
  ),
);

export const WorkspaceTabs = { ...Tabs, List, Trigger };
