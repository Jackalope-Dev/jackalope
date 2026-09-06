import { Check, Copy, FileDiff } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/button';
import { CodeSurface } from './CodeSurface';
import './task-experience.css';

export function PatchPreview({ patch }: { patch: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const lines = patch.split('\n').map((text, number) => ({ text, number }));
  const visible = expanded ? lines : lines.slice(0, 160);
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
    <details className="task-patch">
      <summary className="task-experience-summary">
        <FileDiff size={18} aria-hidden="true" />
        Read patch<span className="task-experience-meta">Unified diff</span>
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
      <CodeSurface className="task-patch-code" label="Workspace patch">
        <code>
          {visible.map(({ text: line, number }) => (
            <span
              key={number}
              className="task-patch-line"
              data-tone={
                line.startsWith('+++') ||
                line.startsWith('---') ||
                line.startsWith('diff ') ||
                line.startsWith('@@')
                  ? 'header'
                  : line.startsWith('+')
                    ? 'add'
                    : line.startsWith('-')
                      ? 'remove'
                      : undefined
              }
            >
              {line}
              {number < visible.length - 1 ? '\n' : ''}
            </span>
          ))}
        </code>
      </CodeSurface>
      {!expanded && lines.length > visible.length && (
        <Button variant="ghost" onClick={() => setExpanded(true)}>
          Show all {lines.length} lines
        </Button>
      )}
    </details>
  );
}
