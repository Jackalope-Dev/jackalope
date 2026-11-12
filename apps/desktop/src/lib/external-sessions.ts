import { invokeNative } from './native/transport';

/** A Claude Code or Codex conversation someone had outside Jackalope, read from that CLI's store. */
export interface ExternalSession {
  /** `<agent>:<session id>`. */
  key: string;
  agent: string;
  agentName: string;
  sessionId: string;
  projectId: string;
  title: string;
  cwd: string;
  branch?: string | null;
  startedAt?: string | null;
  updatedAt: string;
  /** Why it cannot be continued in Jackalope, when it cannot. */
  unavailable?: string | null;
}

export interface ExternalSessionsView {
  enabled: boolean;
  sessions: ExternalSession[];
  refreshing: boolean;
  error?: string | null;
}

interface ExternalTranscriptEntry {
  role: 'user' | 'assistant' | 'tools';
  text: string;
  tools?: string[];
  at?: string | null;
}

export interface ExternalTranscript {
  session: ExternalSession;
  entries: ExternalTranscriptEntry[];
  /** Entries before the first one shown, left out because the transcript is long. */
  earlier: number;
  subagentLines: number;
}

export const listExternalSessions = () =>
  invokeNative<ExternalSessionsView>('external_sessions_list');

export const setExternalSessionsEnabled = (enabled: boolean) =>
  invokeNative<void>('external_sessions_set_enabled', { enabled });

export const externalSessionTranscript = (key: string) =>
  invokeNative<ExternalTranscript>('external_session_transcript', { key });

/** Starts a conversation whose first message resumes the session where it ran. */
export const continueExternalSession = (key: string, text: string) =>
  invokeNative<string>('external_session_continue', {
    key,
    conversationId: crypto.randomUUID(),
    messageId: crypto.randomUUID(),
    text,
  });
