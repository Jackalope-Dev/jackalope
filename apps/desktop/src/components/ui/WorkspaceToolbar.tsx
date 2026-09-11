import { Toolbar } from '@jackalope/ui';
import type { ComponentProps } from 'react';
import './shared-controls.css';

export { SegmentedControl as FilterGroup } from '@jackalope/ui';
export function WorkspaceToolbar(props: ComponentProps<typeof Toolbar>) {
  return (
    <Toolbar
      {...props}
      className={['workspace-toolbar', props.className].filter(Boolean).join(' ')}
    />
  );
}
