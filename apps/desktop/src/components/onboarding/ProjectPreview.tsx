import { FolderSearch, GitBranch, GitCommitHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type CodebaseSnapshot, scanCodebase } from '../../lib/codebase';
import { nativeTask } from '../../lib/task-runtime';

interface ProjectInfo {
  path: string;
  name: string;
  branch: string;
  repository: boolean;
}

interface Commit {
  subject: string;
  author: string;
  when: string;
}

interface LanguageShare {
  name: string;
  share: number;
}

/** Named languages shown in the bar before the rest fold into Other. */
const SHOWN_LANGUAGES = 4;
const count = new Intl.NumberFormat();
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/** Share of recognized source by size, largest first; unrecognized files (assets) are left out. */
function languageShares(snapshot: CodebaseSnapshot): LanguageShare[] {
  const bytes = new Map<string, number>();
  for (const file of snapshot.files)
    if (file.language !== 'Other')
      bytes.set(file.language, (bytes.get(file.language) ?? 0) + file.bytes);
  const total = [...bytes.values()].reduce((sum, value) => sum + value, 0);
  if (!total) return [];
  const sorted = [...bytes].sort((a, b) => b[1] - a[1]);
  const shown = sorted.slice(0, SHOWN_LANGUAGES).map(([name, size]) => ({
    name,
    share: size / total,
  }));
  const rest = sorted.slice(SHOWN_LANGUAGES).reduce((sum, [, size]) => sum + size, 0);
  return rest ? [...shown, { name: 'Other', share: rest / total }] : shown;
}

const percent = (share: number) => (share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`);

/**
 * A quick, local overview of the folder being chosen: name, branch, size, languages and the
 * latest commit. Everything comes from the file system and Git, so it works before any agent
 * is set up. The panel keeps one size while empty, loading and loaded.
 */
export function ProjectPreview({ path }: { path: string }) {
  const target = path.trim();
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<CodebaseSnapshot | null>(null);
  const [commit, setCommit] = useState<Commit | null>(null);
  const [reading, setReading] = useState(false);
  useEffect(() => {
    setInfo(null);
    setError('');
    setSnapshot(null);
    setCommit(null);
    setReading(false);
    if (!target) return;
    let current = true;
    // Typed paths settle before anything is read.
    const timer = window.setTimeout(async () => {
      try {
        const project = await nativeTask<ProjectInfo>('task_validate_project', { path: target });
        if (!current) return;
        setInfo(project);
        setReading(true);
        const commits = project.repository
          ? nativeTask<{ commit: Commit | null }[]>('project_commit_graph', {
              projectPath: project.path,
              limit: 1,
            })
              .then(
                (lines) => current && setCommit(lines.find((line) => line.commit)?.commit ?? null),
              )
              .catch(() => {})
          : Promise.resolve();
        const files = scanCodebase(project.path, false)
          .then((value) => current && setSnapshot(value))
          .catch(() => {});
        await Promise.all([commits, files]);
      } catch (cause) {
        if (current) setError(typeof cause === 'string' ? cause : String(cause));
      } finally {
        if (current) setReading(false);
      }
    }, 400);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [target]);

  if (!info)
    return (
      <section className="project-preview project-preview-empty" aria-live="polite">
        <FolderSearch size={20} aria-hidden="true" />
        <p>
          {error
            ? `This folder can't be opened. ${error}`
            : 'Choose a folder to see a quick overview of it.'}
        </p>
      </section>
    );

  const shares = snapshot ? languageShares(snapshot) : [];
  const lines = snapshot?.files.reduce((sum, file) => sum + (file.lines ?? 0), 0) ?? 0;
  const more = snapshot?.truncated ? '+' : '';
  const pending = reading ? 'Reading…' : '–';
  return (
    <section className="project-preview" aria-label={`${info.name} overview`} aria-live="polite">
      <header className="project-preview-header">
        <span className="project-preview-mark" aria-hidden="true">
          {info.name.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <div className="project-preview-identity">
          <strong>{info.name}</strong>
          <span className="project-preview-path" title={info.path}>
            {info.path}
          </span>
        </div>
        <span className="project-preview-branch">
          <GitBranch size={14} aria-hidden="true" className="project-preview-icon" />
          {info.repository ? info.branch || 'Detached' : 'No Git'}
        </span>
      </header>
      <dl className="project-preview-stats">
        <div className="project-preview-stat">
          <dt>Files</dt>
          <dd>{snapshot ? `${count.format(snapshot.files.length)}${more}` : pending}</dd>
        </div>
        <div className="project-preview-stat">
          <dt>Lines</dt>
          <dd>{snapshot ? `${compact.format(lines)}${more}` : pending}</dd>
        </div>
        <div className="project-preview-stat">
          <dt>Last commit</dt>
          <dd>{commit?.when ?? (info.repository ? pending : 'Not tracked')}</dd>
        </div>
      </dl>
      {shares.length > 0 && (
        <div className="project-preview-languages">
          <div
            className="project-preview-bar"
            role="img"
            aria-label={`Languages: ${shares.map((item) => `${item.name} ${percent(item.share)}`).join(', ')}`}
          >
            {shares.map((item, index) => (
              <span
                key={item.name}
                className="project-preview-segment"
                data-series={item.name === 'Other' ? 'other' : index + 1}
                style={{ flexGrow: item.share }}
                title={`${item.name} ${percent(item.share)}`}
              />
            ))}
          </div>
          <ul className="project-preview-legend">
            {shares.map((item, index) => (
              <li key={item.name}>
                <span
                  className="project-preview-swatch"
                  data-series={item.name === 'Other' ? 'other' : index + 1}
                  aria-hidden="true"
                />
                {item.name}
                <span className="project-preview-share">{percent(item.share)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {commit && (
        <p className="project-preview-commit" title={`${commit.subject} · ${commit.author}`}>
          <GitCommitHorizontal size={14} aria-hidden="true" className="project-preview-icon" />
          <span className="project-preview-subject">{commit.subject}</span>
          <span className="project-preview-author">{commit.author}</span>
        </p>
      )}
    </section>
  );
}
