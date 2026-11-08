export type RunStatus =
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'interrupted'
  | 'failed'
  | 'review'
  | 'reviewed';

/** An agent's answer given on the person's behalf. */
export interface AgentAnswer {
  kind: 'agent';
  agent: string;
  model?: string;
  /** The answer without the attribution the asking agent received. */
  answer: string;
  rationale: string;
  confidence: number;
  evidence?: string[];
  runId?: string;
}

/** Something only the person can do; never routed to an agent. */
export interface HumanAction {
  kind: 'secret' | 'sign_in' | 'payment' | 'account' | 'other';
  instructions: string;
  url?: string;
  secretName?: string;
}

export interface PendingUserPrompt {
  id: string;
  runId: string;
  question: string;
  inputType: 'text' | 'choice' | 'confirmation' | 'multiChoice' | 'humanAction';
  options: string[];
  defaultValue?: string | null;
  /** `deciding`: an agent decides first; the person may still answer. */
  status: 'pending' | 'deciding' | 'answered';
  /** Set when an agent answered for the person. */
  answeredBy?: AgentAnswer;
  /** Why it reached the person although agents may decide. */
  escalation?: { category: string; reason: string };
  humanAction?: HumanAction;
  answer?: string | null;
  createdAt: string;
  answeredAt?: string | null;
  /** Optional card structure; absent on older questions. */
  header?: string;
  recommended?: string;
  multiSelect?: boolean;
  allowOther?: boolean;
  rationale?: string;
  /** Why checking the code cannot answer it; plan questions carry one. */
  whyAsk?: string;
}

export interface Review {
  files: string[];
  diff: string;
  note: string;
}

type HasStatus = string | { status: string };
const statusOf = (value: HasStatus) => (typeof value === 'string' ? value : value.status);
const within = (statuses: readonly RunStatus[]) => {
  const set = new Set<string>(statuses);
  return (value: HasStatus) => set.has(statusOf(value));
};

/** The agent process is starting, working or being stopped. */
export const isActive = within(['starting', 'running', 'stopping']);
/** Preparing or working, and not being stopped. */
export const isWorking = within(['starting', 'running']);
/** Active, or cut off by an app restart and able to resume. */
export const isLive = within(['starting', 'running', 'stopping', 'interrupted']);
/** The attempt produced a result to review. */
export const isFinished = within(['review', 'reviewed']);
/** The attempt ended without a result. */
export const isUnfinished = within(['failed', 'stopped', 'interrupted']);
/** The attempt ended and will not resume: a result, a failure or a stop. */
export const isSettled = within(['review', 'reviewed', 'failed', 'stopped']);
/** An attempt that ended without finishing can be tried again from the same task. */
export const canRetry = (run: HasStatus) => isUnfinished(run);

export const statusLabel: Record<RunStatus, string> = {
  starting: 'Preparing workspace',
  running: 'Working',
  stopping: 'Stopping',
  stopped: 'Stopped',
  interrupted: 'Interrupted',
  failed: 'Needs attention',
  review: 'Ready to review',
  reviewed: 'Reviewed',
};

/** A duration as its two largest units: `45s`, `2m 14s`, `3h 05m`, `2d 4h`. */
export function durationLabel(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (!Number.isFinite(seconds)) return '';
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days) return `${days}d ${hours % 24}h`;
  if (hours) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}
/** How long the current step has been running, as a compact `2m 14s`. */
export function elapsedLabel(since: string, now: number = Date.now()): string {
  return durationLabel((now - Date.parse(since)) / 1000);
}
