import { CopyButton } from '@jackalope/ui';
import { FileDiff } from 'lucide-react';
import { useState } from 'react';
import { DiffPreview } from './DiffPreview';
import './task-experience.css';

export function PatchPreview({ patch }: { patch: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="task-patch" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="task-experience-summary">
        <FileDiff size={18} aria-hidden="true" />
        Read patch<span className="task-experience-meta">File changes</span>
      </summary>
      <div className="task-patch-toolbar">
        <span>+ Added · − Removed</span>
        <CopyButton
          text={patch}
          label="Copy patch"
          errorMessage="Could not copy. Select the patch text to copy it manually."
        />
      </div>
      {open && <DiffPreview patch={patch} />}
    </details>
  );
}
