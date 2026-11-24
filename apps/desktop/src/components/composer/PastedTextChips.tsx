import { Button } from '@jackalope/ui';
import { FileText } from 'lucide-react';
import { DismissButton } from '../ui/DismissButton';
import './composer.css';

/** Pasted text that became a text-file attachment, with Undo to put it back inline. */
export function PastedTextChips({
  pasted,
  onUndo,
  onDismiss,
}: {
  pasted: { reference: string; label: string }[];
  onUndo: (reference: string) => void;
  onDismiss: (reference: string) => void;
}) {
  if (!pasted.length) return null;
  return (
    <ul className="composer-chips" aria-label="Pasted text attached as files">
      {pasted.map((item) => (
        <li key={item.reference} className="composer-chip">
          <FileText size={14} aria-hidden="true" />
          <span title={item.reference}>{item.label}, attached as a file</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onUndo(item.reference)}>
            Undo
          </Button>
          <DismissButton label="Keep as a file" onDismiss={() => onDismiss(item.reference)} />
        </li>
      ))}
    </ul>
  );
}
