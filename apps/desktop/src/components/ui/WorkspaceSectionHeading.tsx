import { cn, SectionHeader } from '@jackalope/ui';
import type { ComponentProps } from 'react';
import './workspace-layout.css';
export function WorkspaceSectionHeading(props: ComponentProps<typeof SectionHeader>) {
  return <SectionHeader {...props} className={cn('workspace-section-header', props.className)} />;
}
