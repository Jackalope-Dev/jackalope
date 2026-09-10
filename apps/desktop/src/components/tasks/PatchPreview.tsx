import { Check, Copy, FileDiff } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/button';
import { DiffPreview } from './DiffPreview';
import './task-experience.css';

export function PatchPreview({ patch }: { patch: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const copy = async () => {
    setError('');
    try {
      await navigator.clipboard.writeText(patch);
      setCopied(true);
    } catch {
      setError('Could not copy. Select the patch text to copy it manually.');
    }
  };
  return (
    <details className="task-patch" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="task-experience-summary">
        <FileDiff size={18} aria-hidden="true" />
        Read patch<span className="task-experience-meta">File changes</span>
      </summary>
      <div className="task-patch-toolbar">
        <span>+ Added · − Removed</span>
        <Button variant="ghost" onClick={() => void copy()}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copied' : 'Copy patch'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="task-experience-error">
          {error}
        </p>
      )}
      {open && <DiffPreview patch={patch} />}
    </details>
  );
}
