import { create } from 'zustand';

export interface CompanionNotice {
  id: string;
  title: string;
  detail: string;
  kind: 'attention' | 'success' | 'info';
  actionLabel?: string;
  onOpen?: () => void;
  onDismiss?: () => void;
}

const storageKey = 'jackalope-companion-read-v1';
function readSaved(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string').slice(-500) : [];
  } catch {
    return [];
  }
}

export const useCompanionStore = create<{
  sources: Record<string, CompanionNotice[]>;
  readIds: string[];
  publish: (source: string, notices: CompanionNotice[]) => void;
  remove: (source: string) => void;
  markRead: (ids: string[]) => void;
}>()((set) => ({
  sources: {},
  readIds: readSaved(),
  publish: (source, notices) =>
    set((state) => ({ sources: { ...state.sources, [source]: notices } })),
  remove: (source) =>
    set((state) => {
      const sources = { ...state.sources };
      delete sources[source];
      return { sources };
    }),
  markRead: (ids) =>
    set((state) => {
      const readIds = [...new Set([...state.readIds, ...ids])].slice(-500);
      try {
        localStorage.setItem(storageKey, JSON.stringify(readIds));
      } catch {}
      return { readIds };
    }),
}));

export function sortNotices(notices: CompanionNotice[]): CompanionNotice[] {
  const rank = { attention: 0, success: 1, info: 2 };
  return [...new Map(notices.map((notice) => [notice.id, notice])).values()].sort(
    (a, b) => rank[a.kind] - rank[b.kind],
  );
}

export function shouldNotify(kind: CompanionNotice['kind'], level: string): boolean {
  return level === 'all' || (level === 'failures-only' && kind === 'attention');
}
