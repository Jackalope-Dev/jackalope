import type { ScreenshotArtifact, TaskRun } from '../../lib/run-types';
import { runTitle } from '../../lib/task-title';

/** A file the Library page lists, as `library_files` returns it. */
export interface LibraryFile {
  path: string;
  name: string;
  /** `output` saved agent output, `attachment` a pasted prompt image, `changed` an image or PDF a task changed. */
  source: 'output' | 'attachment' | 'changed';
  projectId: string;
  runId?: string | null;
  size: number;
  /** Unix milliseconds. */
  modified: number;
}

export type LibraryKind = 'screenshots' | 'images' | 'files';

/** Where an item came from, as its tile names it. */
type Origin = 'screenshot' | 'desktop' | 'review' | 'output' | 'attachment' | 'changed';

export interface LibraryItem {
  key: string;
  kind: LibraryKind;
  origin: Origin;
  title: string;
  /** The work that produced it, when one did. */
  run?: Pick<TaskRun, 'id' | 'liveSessionId'> & { title: string };
  projectId: string;
  path: string;
  /** Unix milliseconds; 0 when unknown. */
  at: number;
  /** How to load a thumbnail; absent for files that are not images. */
  preview?: { screenshot: string; runId: string } | { file: string };
}

export const ORIGIN_LABELS: Record<Origin, string> = {
  screenshot: 'Agent screenshot',
  desktop: 'Desktop capture',
  review: 'Review capture',
  output: 'Saved output',
  attachment: 'Pasted image',
  changed: 'Changed in repo',
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
/** Matches the native open allowlist; other files only show in the file manager. */
export const OPENABLE = new Set([
  ...IMAGE_EXTENSIONS,
  ...['pdf', 'txt', 'md', 'json', 'csv', 'log', 'html', 'htm'],
]);

export function extension(name: string) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function imageType(name: string) {
  const ext = extension(name);
  if (!IMAGE_EXTENSIONS.has(ext)) return undefined;
  return ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
}

const time = (text: string | undefined) => {
  const value = text ? Date.parse(text) : Number.NaN;
  return Number.isNaN(value) ? 0 : value;
};

/**
 * Everything the Library shows, newest first: screenshots recorded on runs and the
 * files the native side found in output and attachment folders. A file recorded as a
 * screenshot appears once.
 */
export function libraryItems(runs: TaskRun[], files: LibraryFile[]): LibraryItem[] {
  const items: LibraryItem[] = [];
  const seen = new Set<string>();
  const byId = new Map(runs.map((run) => [run.id, run]));
  const source = (run: TaskRun) => ({
    id: run.id,
    liveSessionId: run.liveSessionId,
    title: runTitle(run),
  });
  const capture = (run: TaskRun, shot: ScreenshotArtifact, origin: Origin, at?: string) => {
    if (!shot.filePath || seen.has(shot.filePath)) return;
    seen.add(shot.filePath);
    items.push({
      key: `${run.id}:${shot.id}`,
      kind: 'screenshots',
      origin,
      title: shot.name || ORIGIN_LABELS[origin],
      run: source(run),
      projectId: run.projectId,
      path: shot.filePath,
      at: time(shot.timestamp) || time(at) || time(run.startedAt),
      preview: { screenshot: shot.id, runId: run.id },
    });
  };
  for (const run of runs) {
    for (const shot of run.screenshots ?? []) capture(run, shot, 'screenshot');
    for (const action of run.desktopActions ?? [])
      if (action.capture) capture(run, action.capture, 'desktop', action.at);
    for (const page of run.reviewCaptures?.pages ?? [])
      for (const shot of [page.before, page.after])
        if (shot) capture(run, shot, 'review', run.reviewCaptures?.capturedAt);
  }
  for (const file of files) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    const run = file.runId ? byId.get(file.runId) : undefined;
    const image = !!imageType(file.name);
    items.push({
      key: file.path,
      kind: image ? 'images' : 'files',
      origin: file.source,
      title: file.name,
      run: run && source(run),
      projectId: file.projectId,
      path: file.path,
      at: file.modified,
      preview: image ? { file: file.path } : undefined,
    });
  }
  return items.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
}
