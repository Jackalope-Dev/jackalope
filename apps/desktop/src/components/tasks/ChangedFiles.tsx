import { Checkbox, Input } from '@jackalope/ui';
import { FileCode2, Files } from 'lucide-react';
import { type CSSProperties, useId, useMemo, useState } from 'react';
import { reviewFingerprint } from '../../lib/review-fingerprint';
import { useFileReviewStore } from '../../stores/fileReviewStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { ResizeHandle } from '../ui/ResizeHandle';
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
  const listId = useId();
  const listWidth = useWorkViewStore((state) => state.sizes['changed-files']);
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const file = files.includes(selected) ? selected : '';
  const matches = files.filter((path) => path.toLowerCase().includes(search.toLowerCase()));
  return (
    <div
      className="changed-files"
      style={
        listWidth === undefined
          ? undefined
          : ({ '--changed-files-width': `${listWidth}px` } as CSSProperties)
      }
    >
      {files.length > 0 && (
        <nav id={listId} className="changed-files-list" aria-label="Changed files">
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
      {files.length > 0 && (
        <ResizeHandle
          orientation="vertical"
          label="Resize file list"
          controls={listId}
          className="changed-files-resizer"
          value={listWidth ?? 200}
          min={140}
          max={520}
          onResize={(width) => useWorkViewStore.getState().setSize('changed-files', width)}
          onReset={() => useWorkViewStore.getState().setSize('changed-files', null)}
        />
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
