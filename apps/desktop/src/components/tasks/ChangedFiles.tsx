import { Checkbox, Input } from '@jackalope/ui';
import { FileCode2, Files } from 'lucide-react';
import { useMemo, useState } from 'react';
import { reviewFingerprint } from '../../lib/review-fingerprint';
import { useFileReviewStore } from '../../stores/fileReviewStore';
import { DiffPreview } from './DiffPreview';
import './changed-files.css';

export function ChangedFiles({
  files,
  patch,
  visible = true,
  reviewId,
}: {
  files: string[];
  patch: string;
  visible?: boolean;
  reviewId?: string;
}) {
  const revision = useMemo(
    () => `${reviewId}:${reviewFingerprint(JSON.stringify(files) + patch)}`,
    [reviewId, files, patch],
  );
  const reviewed = useFileReviewStore((state) => state.reviewed[revision]);
  const mark = useFileReviewStore((state) => state.mark);
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const file = files.includes(selected) ? selected : '';
  const matches = files.filter((path) => path.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="changed-files">
      {files.length > 0 && (
        <nav className="changed-files-list" aria-label="Changed files">
          {reviewId && (
            <p
              className="changed-files-progress"
              role="status"
              title="Review marks reset when changes update"
            >
              {files.filter((path) => reviewed?.includes(path)).length} of {files.length} reviewed
            </p>
          )}
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
              <div key={path} className="changed-file-row">
                <button
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
                {reviewId && (
                  <label className="changed-file-check" title="Mark file reviewed">
                    <Checkbox
                      aria-label={`Reviewed: ${path}`}
                      checked={reviewed?.includes(path) ?? false}
                      onChange={(event) => mark(revision, path, event.target.checked)}
                    />
                  </label>
                )}
              </div>
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
