import { useEffect, useState } from 'react';
import { isTauriEnvironment } from '../lib/native/env';
import { invokeNative } from '../lib/native/transport';

const fileCache = new Map<string, { files: string[]; loadedAt: number }>();

/**
 * The project's Git-listed files (tracked and untracked, without ignored ones), refreshed
 * at most every 30 seconds and shared by command search and composer mentions.
 */
export function useProjectFiles(projectPath: string | undefined, enabled: boolean) {
  const [files, setFiles] = useState<string[]>(
    () => (projectPath && fileCache.get(projectPath)?.files) || [],
  );
  useEffect(() => {
    if (!enabled || !projectPath || !isTauriEnvironment()) return;
    const cached = fileCache.get(projectPath);
    if (cached) setFiles(cached.files);
    if (cached && Date.now() - cached.loadedAt < 30_000) return;
    let canceled = false;
    invokeNative<string[]>('project_files_list', { projectPath })
      .then((list) => {
        fileCache.set(projectPath, { files: list, loadedAt: Date.now() });
        if (!canceled) setFiles(list);
      })
      .catch(() => {
        if (!canceled) setFiles([]);
      });
    return () => {
      canceled = true;
    };
  }, [projectPath, enabled]);
  return files;
}
