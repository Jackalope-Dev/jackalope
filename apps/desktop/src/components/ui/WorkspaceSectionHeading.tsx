import { SectionHeader } from '@jackalope/ui';
import type { ComponentProps } from 'react';
import './workspace-layout.css';
export function WorkspaceSectionHeading(props: ComponentProps<typeof SectionHeader>) {
  return (
    <SectionHeader
      {...props}
      className={['workspace-section-header', props.className].filter(Boolean).join(' ')}
    />
  );
}
