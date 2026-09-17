import { Input } from '@jackalope/ui';
import { FileCode2, Files } from 'lucide-react';
import { useState } from 'react';
import { DiffPreview } from './DiffPreview';
import './changed-files.css';

export function ChangedFiles({
  files,
  patch,
  visible = true,
}: {
  files: string[];
  patch: string;
  visible?: boolean;
}) {
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const file = files.includes(selected) ? selected : '';
  const matches = files.filter((path) => path.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="changed-files">
      {files.length > 0 && (
        <nav className="changed-files-list" aria-label="Changed files">
          {files.length > 1 && (
            <Input
              aria-label="Filter changed files"
              placeholder="Find a file…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
          <button type="button" aria-pressed={!file} onClick={() => setSelected('')}>
            <Files size={15} aria-hidden="true" />
            <span>
              All changes <small>{files.length}</small>
            </span>
          </button>
          {matches.map((path) => {
            const parts = path.split('/');
            const name = parts.pop();
            return (
              <button
                key={path}
                type="button"
                aria-label={path}
                aria-pressed={file === path}
                title={path}
                onClick={() => setSelected(path)}
              >
                <FileCode2 size={15} aria-hidden="true" />
                <span>
                  {name}
                  {parts.length > 0 && <small>{parts.join('/')}</small>}
                </span>
              </button>
            );
          })}
          {!matches.length && <p className="task-muted">No matching files.</p>}
        </nav>
      )}
      <div className="changed-files-diff">
        {patch ? (
          visible && <DiffPreview patch={patch} file={file || undefined} />
        ) : (
          <p className="task-muted">No text changes to review.</p>
        )}
      </div>
    </div>
  );
}
