import { PageHeader } from '@jackalope/ui';
import type { ComponentProps } from 'react';
import './workspace-layout.css';
export function WorkspaceHeading(props: ComponentProps<typeof PageHeader>) {
  return (
    <PageHeader
      {...props}
      className={['workspace-heading', props.className].filter(Boolean).join(' ')}
    />
  );
}
