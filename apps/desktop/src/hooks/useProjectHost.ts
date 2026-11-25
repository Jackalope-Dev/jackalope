import { invokeNative } from '../lib/native/transport';
import type { ProjectHost } from '../lib/source-control';
import { useNativeResource } from './useNativeResource';

/** Reads are shared for a minute: several delivery controls ask about the same project. */
const FRESH_MS = 60_000;
const cache = new Map<string, { at: number; host: Promise<ProjectHost> }>();

export function readProjectHost(projectPath: string, fresh = false) {
  const cached = cache.get(projectPath);
  if (!fresh && cached && Date.now() - cached.at < FRESH_MS) return cached.host;
  const host = invokeNative<ProjectHost>('project_source_control', { projectPath });
  cache.set(projectPath, { at: Date.now(), host });
  host.catch(() => cache.delete(projectPath));
  return host;
}

/** Forgets every project's host after a settings change. */
export function forgetProjectHosts() {
  cache.clear();
}

/**
 * The project's code host and what Jackalope can do there. Until it is known, or where it
 * cannot be read (the browser preview), callers keep the GitHub behavior they had.
 */
export function useProjectHost(projectPath: string | undefined) {
  return useNativeResource(() => readProjectHost(projectPath ?? ''), [projectPath], {
    enabled: !!projectPath,
  });
}
