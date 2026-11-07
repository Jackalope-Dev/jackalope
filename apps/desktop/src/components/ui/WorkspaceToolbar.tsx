import { cn, Toolbar } from '@jackalope/ui';
import type { ComponentProps } from 'react';
import './shared-controls.css';

export function WorkspaceToolbar(props: ComponentProps<typeof Toolbar>) {
  return <Toolbar {...props} className={cn('workspace-toolbar', props.className)} />;
}
