import { isTauriEnvironment } from './tauri-bridge.ts';

export interface CodebaseFile {
  path: string;
  language: string;
  bytes: number;
  lines: number | null;
  analyzed: boolean;
}

export interface CodebaseReference {
  source: string;
  target: string | null;
  specifier: string;
  line: number;
  kind: string;
  status: 'resolved' | 'unresolved' | 'outside root' | 'package or alias' | 'unsupported';
}

export interface CodebaseSnapshot {
  root: string;
  scannedAt: string;
  durationMs: number;
  files: CodebaseFile[];
  references: CodebaseReference[];
  cycles: string[][];
  diagnostics: { path: string; message: string }[];
  truncated: boolean;
}

const snapshots = new Map<string, { value: CodebaseSnapshot; at: number }>();
const scans = new Map<string, Promise<CodebaseSnapshot>>();
let prepared: { path: string; result: Promise<CodebaseSnapshot> } | undefined;

export function scanCodebase(repoPath: string, force = true): Promise<CodebaseSnapshot> {
  const cached = snapshots.get(repoPath);
  if (!force && cached && Date.now() - cached.at < 120_000) return Promise.resolve(cached.value);
  const pending = scans.get(repoPath);
  if (pending) return pending;
  if (prepared?.path === repoPath) prepared = undefined;
  const result = (async () => {
    if (!isTauriEnvironment()) throw new Error('Open the desktop app to analyze local files.');
    const { invoke } = await import('@tauri-apps/api/core');
    const value = await invoke<CodebaseSnapshot>('codebase_scan', { repoPath });
    if (snapshots.size >= 8) snapshots.delete(snapshots.keys().next().value!);
    snapshots.set(repoPath, { value, at: Date.now() });
    return value;
  })().finally(() => scans.delete(repoPath));
  scans.set(repoPath, result);
  return result;
}

export function prepareCodebase(repoPath: string): Promise<CodebaseSnapshot> {
  const result = scanCodebase(repoPath);
  prepared = { path: repoPath, result };
  return result;
}

export function preparedCodebase(repoPath: string): Promise<CodebaseSnapshot> | undefined {
  return prepared?.path === repoPath ? prepared.result : undefined;
}

export async function watchCodebase(repoPath: string, onChange: (unavailable: boolean) => void) {
  const [{ invoke }, { listen }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
  ]);
  let id: string | undefined;
  const unlisten = await listen<{ id: string; unavailable: boolean }>(
    'codebase-changed',
    (event) => {
      if (event.payload.id === id) onChange(event.payload.unavailable);
    },
  );
  try {
    id = await invoke<string>('codebase_watch', { repoPath });
  } catch (error) {
    unlisten();
    throw error;
  }
  return async () => {
    unlisten();
    await invoke('codebase_unwatch', { id });
  };
}
