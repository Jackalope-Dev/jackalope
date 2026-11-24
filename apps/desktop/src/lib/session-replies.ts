import type { TaskRun } from './run-types.ts';

/** The newest replies a conversation snapshot carries in full; older ones load on demand. */
export const REPLY_WINDOW = 40;
/** Runs one `live_session_results` call may name. */
const PAGE_RUNS = 500;

export interface SessionReply {
  id: string;
  result: string;
}

/** Whether a reply's text was left out of the snapshot and still has to be loaded. */
export const replyOmitted = (run: TaskRun | undefined) => !!run?.resultOmitted && !run.result;

/**
 * Loads the text of `ids` page by page through `fetchPage`, which returns at most a page of
 * replies in the order asked, and hands each page to `apply`. Stops when a page returns
 * nothing new, so a run that disappeared cannot loop forever.
 */
export async function loadReplyPages(
  ids: readonly string[],
  fetchPage: (ids: string[]) => Promise<SessionReply[]>,
  apply: (replies: SessionReply[]) => void,
) {
  let remaining = [...new Set(ids)];
  while (remaining.length) {
    const page = await fetchPage(remaining.slice(0, PAGE_RUNS));
    if (!page.length) return;
    apply(page);
    const loaded = new Set(page.map((reply) => reply.id));
    remaining = remaining.filter((id) => !loaded.has(id));
  }
}

/** Runs with their loaded replies filled in; untouched runs keep their identity. */
export function withReplies(runs: TaskRun[], replies: readonly SessionReply[]) {
  const text = new Map(replies.map((reply) => [reply.id, reply.result]));
  let changed = false;
  const next = runs.map((run) => {
    const result = text.get(run.id);
    if (result === undefined || !replyOmitted(run)) return run;
    changed = true;
    return { ...run, result, resultOmitted: false };
  });
  return changed ? next : runs;
}

/**
 * Keeps text already loaded for replies that a refresh resent without it, such as one
 * the reply window just moved past, while its length is unchanged; `changed` are the runs
 * the refresh sent.
 */
export function keepLoadedReplies(
  previous: TaskRun[],
  next: TaskRun[],
  changed: readonly TaskRun[],
) {
  const resent = new Set(changed.filter(replyOmitted).map((run) => run.id));
  if (!resent.size) return next;
  const loaded = new Map(
    previous
      .filter((run) => resent.has(run.id) && run.result && !run.resultOmitted)
      .map((run) => [run.id, run.result]),
  );
  if (!loaded.size) return next;
  return next.map((run) => {
    const text = loaded.get(run.id);
    return text !== undefined && replyOmitted(run) && [...text].length === run.resultChars
      ? { ...run, result: text, resultOmitted: false }
      : run;
  });
}
