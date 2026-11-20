import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  InlineNotice,
  SegmentedControl,
  type SegmentItem,
  Select,
  SelectItem,
} from '@jackalope/ui';
import {
  Camera,
  File,
  FileCode2,
  FileDiff,
  FileText,
  FolderOpen,
  Images,
  type LucideIcon,
  Monitor,
  Paperclip,
  ScanEye,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { navigateWorkspace } from '../../lib/app-events';
import { fileManagerName, revealInFileManager } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import { openConversation, openRun, useAllRuns } from '../../lib/work-selection';
import { useLibraryStore } from '../../stores/libraryStore';
import { useProjectStore } from '../../stores/projectStore';
import { ProjectMark } from '../projects/ProjectMark';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import {
  extension,
  imageType,
  type LibraryFile,
  type LibraryItem,
  type LibraryKind,
  libraryItems,
  OPENABLE,
  ORIGIN_LABELS,
} from './library-items';
import './library.css';

const PAGE = 60;
const ALL = 'all';

const ORIGIN_ICONS: Record<LibraryItem['origin'], LucideIcon> = {
  screenshot: Camera,
  desktop: Monitor,
  review: ScanEye,
  output: Sparkles,
  attachment: Paperclip,
  changed: FileDiff,
};

function fileIcon(name: string): LucideIcon {
  const ext = extension(name);
  if (['html', 'htm', 'json', 'js', 'ts', 'css', 'xml', 'yaml', 'yml'].includes(ext))
    return FileCode2;
  if (['md', 'txt', 'pdf', 'csv', 'log', 'rtf'].includes(ext)) return FileText;
  return File;
}

/** Thumbnails decoded so far; the oldest are released past the cap. */
const thumbnails = new Map<string, string>();
const THUMBNAIL_CAP = 150;

function remember(key: string, url: string) {
  thumbnails.set(key, url);
  for (const [old, oldUrl] of thumbnails) {
    if (thumbnails.size <= THUMBNAIL_CAP) break;
    thumbnails.delete(old);
    URL.revokeObjectURL(oldUrl);
  }
}

async function loadPreview(item: LibraryItem): Promise<string> {
  const cached = thumbnails.get(item.key);
  if (cached) return cached;
  if (!item.preview) throw new Error('No preview');
  const bytes =
    'screenshot' in item.preview
      ? await invokeNative<number[]>('task_screenshot', {
          runId: item.preview.runId,
          screenshotId: item.preview.screenshot,
        })
      : await invokeNative<number[]>('library_file_preview', { path: item.preview.file });
  const type = 'screenshot' in item.preview ? 'image/png' : imageType(item.title) || 'image/png';
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
  remember(item.key, url);
  return url;
}

/** An image loaded once the tile scrolls near the viewport. */
function Preview({ item, eager = false }: { item: LibraryItem; eager?: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);
  const [source, setSource] = useState(() => thumbnails.get(item.key) ?? '');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (visible || !frame.current) return;
    const observer = new IntersectionObserver(
      (entries) => entries.some((entry) => entry.isIntersecting) && setVisible(true),
      { rootMargin: '200px' },
    );
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible || source || !item.preview) return;
    let current = true;
    loadPreview(item).then(
      (url) => current && setSource(url),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [visible, source, item]);
  const Icon = item.preview ? ORIGIN_ICONS[item.origin] : fileIcon(item.title);
  return (
    <div ref={frame} className="library-preview" data-kind={item.kind}>
      {source && !failed ? (
        <img src={source} alt="" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span className="library-preview-placeholder">
          <Icon size={28} aria-hidden="true" />
          {!item.preview && extension(item.title) && (
            <span className="library-preview-type">{extension(item.title)}</span>
          )}
          {failed && <span className="library-preview-note">Preview unavailable</span>}
        </span>
      )}
    </div>
  );
}

const when = (at: number) =>
  at
    ? new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : 'Date unknown';

/** Screenshots, images and files Jackalope's work produced, across projects. */
export function LibraryPage() {
  const runs = useAllRuns();
  const projects = useProjectStore((state) => state.projects);
  const [files, setFiles] = useState<LibraryFile[] | null>(null);
  const [error, setError] = useState('');
  const { project: savedProject, kind, setProject, setKind } = useLibraryStore();
  // A remembered project that was since removed shows everything.
  const project = projects.some((entry) => entry.id === savedProject) ? savedProject : ALL;
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const [actionError, setActionError] = useState('');

  // Runs change while work streams; the folder listing only needs a fresh look per visit
  // and when the run count changes.
  const runCount = runs.length;
  useEffect(() => {
    let current = true;
    void runCount;
    invokeNative<LibraryFile[]>('library_files').then(
      (next) => {
        if (!current) return;
        setFiles(next);
        setError('');
      },
      (reason) => current && setError(describeError(reason)),
    );
    return () => {
      current = false;
    };
  }, [runCount]);

  const items = useMemo(() => libraryItems(runs, files ?? []), [runs, files]);
  const inProject = useMemo(
    () => (project === ALL ? items : items.filter((item) => item.projectId === project)),
    [items, project],
  );
  const visible = useMemo(
    () => (kind === ALL ? inProject : inProject.filter((item) => item.kind === kind)),
    [inProject, kind],
  );
  const count = (value: LibraryKind) => inProject.filter((item) => item.kind === value).length;
  const kinds: SegmentItem<LibraryKind | typeof ALL>[] = [
    { id: ALL, label: 'All', count: inProject.length },
    { id: 'screenshots', label: 'Screenshots', count: count('screenshots') },
    { id: 'images', label: 'Images', count: count('images') },
    { id: 'files', label: 'Files', count: count('files') },
  ];
  const projectsWithItems = projects.filter(
    (entry) => entry.id === project || items.some((item) => item.projectId === entry.id),
  );
  const projectOf = (id: string) => projects.find((entry) => entry.id === id);

  const openSource = (item: LibraryItem) => {
    if (!item.run) return;
    if (item.run.liveSessionId) openConversation(item.run.liveSessionId);
    else openRun(item.run.id);
    navigateWorkspace('kanban');
  };
  const act = async (action: () => Promise<unknown>) => {
    setActionError('');
    try {
      await action();
    } catch (reason) {
      setActionError(describeError(reason));
    }
  };

  const loading = files === null && !error;
  const filtered = project !== ALL || kind !== ALL;
  return (
    <WorkspacePage className="library-page">
      <WorkspaceHeading
        title="Library"
        description="Screenshots, images and files your work created, newest first."
      />
      <div className="library-filters">
        <Select
          value={project}
          onValueChange={(value) => {
            setProject(value);
            setShown(PAGE);
          }}
          aria-label="Project"
          className="library-project-select"
        >
          <SelectItem value={ALL}>All projects</SelectItem>
          {projectsWithItems.map((entry) => (
            <SelectItem key={entry.id} value={entry.id}>
              {entry.name}
            </SelectItem>
          ))}
        </Select>
        <SegmentedControl
          label="Kind"
          items={kinds}
          value={kind}
          onChange={(value) => {
            setKind(value);
            setShown(PAGE);
          }}
        />
      </div>
      {error && (
        <InlineNotice tone="error">
          Saved files could not be listed: {error} Screenshots from your work are still shown.
        </InlineNotice>
      )}
      {loading ? (
        <p role="status" className="library-status">
          Gathering your library…
        </p>
      ) : visible.length === 0 ? (
        filtered && items.length > 0 ? (
          <EmptyState
            icon={Images}
            title="Nothing matches these filters"
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setProject(ALL);
                  setKind(ALL);
                }}
              >
                Show everything
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Images}
            title="Your library fills in as you work"
            description="Screenshots agents take while checking their work, review captures, images you paste into prompts, files agents save and images or PDFs tasks change all land here."
            action={
              <Button variant="primary" onClick={() => navigateWorkspace('kanban')}>
                Start work
              </Button>
            }
          />
        )
      ) : (
        <>
          <ul className="library-grid">
            {visible.slice(0, shown).map((item) => {
              const owner = projectOf(item.projectId);
              const OriginIcon = ORIGIN_ICONS[item.origin];
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    className="library-tile"
                    onClick={() => {
                      setActionError('');
                      setSelected(item);
                    }}
                    title={item.path}
                  >
                    <Preview item={item} />
                    <span className="library-tile-body">
                      <span className="library-tile-title">{item.title}</span>
                      <span className="library-tile-meta">
                        {owner && project === ALL && <ProjectMark project={owner} />}
                        <OriginIcon size={12} aria-hidden="true" />
                        <span className="library-tile-source">
                          {item.run?.title ?? ORIGIN_LABELS[item.origin]}
                        </span>
                        <span className="library-tile-date">{when(item.at)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {visible.length > shown && (
            <Button
              variant="outline"
              className="library-more"
              onClick={() => setShown((value) => value + PAGE)}
            >
              Show {Math.min(PAGE, visible.length - shown)} more
            </Button>
          )}
        </>
      )}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        {selected && (
          <DialogContent className="library-dialog">
            <DialogCloseButton />
            <DialogHeader
              title={selected.title}
              description={[
                ORIGIN_LABELS[selected.origin],
                projectOf(selected.projectId)?.name,
                selected.at
                  ? new Date(selected.at).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            />
            <div className="library-dialog-body">
              <Preview item={selected} eager />
              {selected.run && (
                <p className="library-dialog-source">
                  From <strong>{selected.run.title}</strong>
                </p>
              )}
              <code className="library-dialog-path">{selected.path}</code>
              {actionError && <InlineNotice tone="error">{actionError}</InlineNotice>}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => act(() => revealInFileManager(selected.path))}
              >
                <FolderOpen size={16} aria-hidden="true" />
                Show in {fileManagerName()}
              </Button>
              {OPENABLE.has(extension(selected.path)) && (
                <Button
                  variant="outline"
                  onClick={() =>
                    act(() => invokeNative('library_file_open', { path: selected.path }))
                  }
                >
                  Open file
                </Button>
              )}
              {selected.run && (
                <Button
                  variant="primary"
                  onClick={() => {
                    const item = selected;
                    setSelected(null);
                    openSource(item);
                  }}
                >
                  Open work
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </WorkspacePage>
  );
}
