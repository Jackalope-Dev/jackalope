import { Tabs } from '@jackalope/ui';
import { type ComponentProps, forwardRef } from 'react';

/** Keyboard tabs with panels, drawn as the shared segmented control. */
const List = forwardRef<HTMLDivElement, ComponentProps<typeof Tabs.List>>((props, ref) => (
  <Tabs.List appearance="segmented" {...props} ref={ref} />
));

export const WorkspaceTabs = { ...Tabs, List };
