import type { RunUsage } from './run-types.ts';

/** How much a note matters: asides stay with the person, concerns and blockers reach the agent. */
export type AdvisorSeverity = 'aside' | 'concern' | 'blocker';

export interface AdvisorNote {
  severity: AdvisorSeverity;
  text: string;
  /** A file, optionally with `:line`, the note is about. */
  path?: string | null;
  /** Withheld from the agent: its advisor follow-up already carried the same issue. */
  repeated?: boolean;
}

/** The turn advisor's review of one attempt, saved on that attempt as `advisor`. */
export interface AdvisorReview {
  status: 'reviewing' | 'done' | 'skipped' | 'failed';
  agent?: string | null;
  model?: string | null;
  account?: string | null;
  notes: AdvisorNote[];
  /** How concerns and blockers reached the working agent, when they did. */
  delivery?: 'followUp' | 'message' | null;
  /** Why the review was skipped or failed, or why its notes stayed with the person. */
  reason?: string | null;
  usage?: RunUsage;
  startedAt: string;
  finishedAt?: string | null;
}

/** The project's turn advisor, saved with its plan settings. */
export interface AdvisorSettings {
  enabled: boolean;
  /** The most notes one review may leave, 1 to 5. */
  maxNotes: number;
  /** The most reviews across one task's turns, 1 to 50. */
  maxReviews: number;
}

export const defaultAdvisorSettings: AdvisorSettings = {
  enabled: false,
  maxNotes: 3,
  maxReviews: 10,
};

/** Whether a note is one the working agent should receive. */
const forAgent = (note: AdvisorNote) => note.severity !== 'aside' && !note.repeated;

/** Splits a review's notes into those sent to the working agent and those shown only to the person. */
export function advisorNotes(review: AdvisorReview) {
  const delivered = review.status === 'done' && !!review.delivery;
  const sent = delivered ? review.notes.filter(forAgent) : [];
  return { sent, kept: review.notes.filter((note) => !sent.includes(note)) };
}

const count = (n: number) => (n === 1 ? '1 note' : `${n} notes`);

/** One line saying where the review stands, naming the advising agent as `name`. */
export function advisorStatus(review: AdvisorReview, name: string): string {
  if (review.status === 'reviewing') return `${name} is reading this turn…`;
  if (review.status === 'skipped') return review.reason || 'The advisor did not run.';
  if (review.status === 'failed')
    return review.reason
      ? `${name} didn’t finish: ${review.reason}`
      : `${name} didn’t finish reading this turn.`;
  if (!review.notes.length) return `${name} read this turn and had no notes.`;
  const { sent } = advisorNotes(review);
  if (sent.length)
    return `${name} sent ${count(sent.length)} to the agent ${
      review.delivery === 'message' ? 'as a message' : 'as a follow-up'
    }.`;
  return review.reason || `${name} left ${count(review.notes.length)} for you.`;
}
