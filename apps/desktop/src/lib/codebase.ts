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

export async function scanCodebase(repoPath: string): Promise<CodebaseSnapshot> {
  if (!isTauriEnvironment()) throw new Error('Open the desktop app to analyze local files.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<CodebaseSnapshot>('codebase_scan', { repoPath });
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
