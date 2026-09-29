import { Checkbox, IconButton } from '@jackalope/ui';
import { Undo2 } from 'lucide-react';
import { ConfirmAction } from '../ui/ConfirmAction';

export interface ChangedFile {
  path: string;
  oldPath: string | null;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';
  staged: boolean;
  additions: number | null;
  deletions: number | null;
}

export const STATUS = {
  modified: { letter: 'M', label: 'Modified' },
  added: { letter: 'A', label: 'Added' },
  untracked: { letter: 'A', label: 'New file' },
  deleted: { letter: 'D', label: 'Deleted' },
  renamed: { letter: 'R', label: 'Renamed' },
  conflicted: { letter: '!', label: 'Conflict' },
} as const;

export function splitPath(path: string) {
  const index = path.lastIndexOf('/');
  return index < 0
    ? { dir: '', name: path }
    : { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}

export function CommitFilesList({
  files,
  chosenFiles,
  allSelected,
  busy,
  selected,
  focused,
  totals,
  checkout,
  setExcluded,
  toggle,
  setFocused,
  discard,
}: {
  files: ChangedFile[];
  chosenFiles: ChangedFile[];
  allSelected: boolean;
  busy: boolean;
  selected: Set<string>;
  focused: string;
  totals: { add: number; del: number };
  checkout: string;
  setExcluded: (checkout: string, paths: string[]) => void;
  toggle: (path: string, included: boolean) => void;
  setFocused: (path: string) => void;
  discard: (file: ChangedFile) => Promise<void> | void;
}) {
  return (
    <section className="commit-files" aria-label="Changed files">
      <header>
        <label>
          <Checkbox
            checked={allSelected}
            indeterminate={chosenFiles.length > 0 && !allSelected}
            disabled={busy}
            onChange={(event) =>
              setExcluded(checkout, event.target.checked ? [] : files.map((file) => file.path))
            }
          />
          <span>
            {chosenFiles.length} of {files.length} selected
          </span>
        </label>
        <span className="commit-stat">
          <ins>+{totals.add}</ins> <del>−{totals.del}</del>
        </span>
      </header>
      <ul>
        {files.map((file) => {
          const { dir, name } = splitPath(file.path);
          const status = STATUS[file.status];
          return (
            <li key={file.path} data-focused={file.path === focused || undefined}>
              <Checkbox
                aria-label={`Include ${file.path}`}
                checked={selected.has(file.path)}
                disabled={busy}
                onChange={(event) => toggle(file.path, event.target.checked)}
              />
              <button
                type="button"
                onClick={() => setFocused(file.path)}
                title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
              >
                <span className="commit-status" data-status={file.status} title={status.label}>
                  {status.letter}
                </span>
                <span className="commit-file-name">
                  <strong>{name}</strong>
                  {dir && <small>{dir}</small>}
                </span>
                {file.additions !== null && (
                  <span className="commit-stat">
                    <ins>+{file.additions}</ins> <del>−{file.deletions ?? 0}</del>
                  </span>
                )}
              </button>
              <ConfirmAction
                title={`Discard changes to ${name}?`}
                description={
                  file.status === 'untracked' || file.status === 'added'
                    ? 'This new file will be deleted. This cannot be undone.'
                    : 'The file goes back to its last committed version. This cannot be undone.'
                }
                label="Discard changes"
                busyLabel="Discarding…"
                onConfirm={() => discard(file)}
                trigger={
                  <IconButton
                    variant="ghost"
                    className="commit-discard"
                    label={`Discard changes to ${file.path}`}
                    title="Discard changes"
                    disabled={busy || file.status === 'conflicted'}
                  >
                    <Undo2 size={15} />
                  </IconButton>
                }
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
