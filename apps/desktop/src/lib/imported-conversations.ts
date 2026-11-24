import type { TranscriptEntry } from './external-sessions.ts';
import { invokeNative } from './native/transport.ts';

/** A Claude Code or Codex session a scan found, as the import dialog lists it. */
export interface ImportCandidate {
  /** `<agent>:<session id>`. */
  key: string;
  agent: string;
  agentName: string;
  sessionId: string;
  title: string;
  cwd: string;
  branch?: string | null;
  startedAt?: string | null;
  /** The newest message, or when the file last changed. */
  lastAt: string;
  messages: number;
  /** `changed`: the CLI wrote to it after it was imported. */
  status: 'new' | 'imported' | 'changed' | 'continued';
}

/** Sessions that ran in one project, or in one repository or folder that is not a project. */
export interface ImportGroup {
  path: string;
  projectId?: string | null;
  exists: boolean;
  repository: boolean;
  sessions: ImportCandidate[];
}

export interface ImportScan {
  groups: ImportGroup[];
  /** The CLI configuration directories read. */
  stores: string[];
  error?: string | null;
}

interface ImportProblem {
  key: string;
  title: string;
  reason: string;
}

export interface ImportProgress {
  running: boolean;
  canceled: boolean;
  total: number;
  done: number;
  imported: number;
  updated: number;
  unchanged: number;
  problems: ImportProblem[];
  current?: string | null;
  /** Why the import stopped early. */
  error?: string | null;
}

/** A conversation imported from Claude Code or Codex, kept in Jackalope's own history. */
export interface ImportedConversation {
  /** `<agent>:<session id>`. */
  id: string;
  agent: string;
  agentName: string;
  sessionId: string;
  projectId: string;
  title: string;
  cwd: string;
  branch?: string | null;
  startedAt?: string | null;
  lastAt?: string | null;
  importedAt: string;
  messages: number;
  /** Entries left out from the start of a very long conversation. */
  earlier: number;
  skippedLines: number;
  subagentLines: number;
  sourcePath: string;
  /** The Jackalope conversation that continued it. */
  continuedIn?: string | null;
  /** Why it cannot be continued in Jackalope, when it cannot. */
  unavailable?: string | null;
  /** Whether its CLI wrote to it after it was imported. */
  changed: boolean;
}

export interface ImportedView {
  conversations: ImportedConversation[];
  progress: ImportProgress;
  error?: string | null;
}

export interface ImportedTranscript {
  conversation: ImportedConversation;
  entries: TranscriptEntry[];
}

export const scanSessionsToImport = () => invokeNative<ImportScan>('session_import_scan');

/** Imports these sessions from the last scan in the background. */
export const startSessionImport = (keys: string[]) =>
  invokeNative<void>('session_import_start', { keys });

export const cancelSessionImport = () => invokeNative<void>('session_import_cancel');

export const listImportedConversations = () =>
  invokeNative<ImportedView>('imported_conversations_list');

export const importedConversationTranscript = (id: string) =>
  invokeNative<ImportedTranscript>('imported_conversation_transcript', { id });

/** Starts a Jackalope conversation whose first message resumes the imported session. */
export const continueImportedConversation = (id: string, text: string) =>
  invokeNative<string>('imported_conversation_continue', {
    id,
    conversationId: crypto.randomUUID(),
    messageId: crypto.randomUUID(),
    text,
  });

/** How recently a conversation was active, for the import dialog's filter. */
export const IMPORT_PERIODS = {
  all: { label: 'Any time', days: null },
  week: { label: 'Past week', days: 7 },
  month: { label: 'Past month', days: 30 },
  quarter: { label: 'Past 3 months', days: 90 },
  year: { label: 'Past year', days: 365 },
} as const;
export type ImportPeriod = keyof typeof IMPORT_PERIODS;

/** Sessions that can be imported now: new ones and ones that grew, in a project. */
export function importable(group: ImportGroup, session: ImportCandidate) {
  return !!group.projectId && (session.status === 'new' || session.status === 'changed');
}

/** The groups with only the sessions active in `period`, leaving out groups left empty. */
export function activeIn(groups: ImportGroup[], period: ImportPeriod, now = Date.now()) {
  const days = IMPORT_PERIODS[period].days;
  if (days === null) return groups;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return groups
    .map((group) => ({
      ...group,
      sessions: group.sessions.filter((session) => {
        const at = new Date(session.lastAt).getTime();
        return Number.isFinite(at) && at >= cutoff;
      }),
    }))
    .filter((group) => group.sessions.length);
}

/** What the dialog selects at first: everything that can be imported now. */
export function initialSelection(groups: ImportGroup[]) {
  return new Set(
    groups.flatMap((group) =>
      group.sessions.filter((session) => importable(group, session)).map((session) => session.key),
    ),
  );
}

/** Whether a scan found anything worth offering: a new conversation in a folder that exists. */
export function worthOffering(scan: ImportScan) {
  return scan.groups.some(
    (group) => group.exists && group.sessions.some((session) => session.status === 'new'),
  );
}

/**
 * Which quarter of a running import is done, so screen readers hear its progress at a few
 * milestones rather than with every conversation.
 */
export function importMilestone(progress: Pick<ImportProgress, 'done' | 'total'>) {
  if (progress.total <= 0) return 0;
  return Math.min(4, Math.floor((progress.done * 4) / progress.total));
}
