import { isActive } from '@jackalope/contracts/runs';
import type { TaskRun } from './run-types.ts';

/**
 * "Edit from here": rewinding a conversation or task to an earlier turn. The native side
 * (`tasks/rewind.rs`) owns the checks and the change; this mirrors its rules so the
 * transcript can say up front whether a turn offers the action, and why not.
 */

interface TurnCheckpoint {
  reference: string;
  commit: string;
  head: string;
  tree: string;
}

type RewindResume =
  | { kind: 'new' }
  | { kind: 'claude'; session: string; at: string }
  | { kind: 'codex'; thread: string };

export interface Rewind {
  id: string;
  at: string;
  turnRunId: string;
  turn: number;
  rewoundRunIds: string[];
  restored: TurnCheckpoint;
  safety: TurnCheckpoint & { index?: string | null };
  resume: RewindResume;
  undoneAt?: string | null;
}

export interface RewindState {
  checkpoint?: TurnCheckpoint | null;
  checkpointError?: string | null;
  mark?: { session: string; entry: string } | null;
  rewound?: { rewindId: string; at: string } | null;
  applied?: Rewind | null;
}

export interface RewindPreview {
  runId: string;
  latestRunId: string;
  turn: number;
  undone: number;
  conversation: 'new' | 'claude' | 'codex';
  prompt: string;
}

export interface RewindOutcome {
  rewind: Rewind;
  prompt: string;
}

export type RewindOption =
  | { state: 'hidden' }
  | { state: 'disabled'; reason: string }
  | { state: 'available' };

const REWINDABLE = new Set(['claude', 'codex']);

const adapterOf = (run: TaskRun) => run.accountBinding?.adapter ?? run.agent;

const samePath = (a: string, b: string) =>
  a.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase() ===
  b.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();

/** A task's attempts, oldest first. */
export const taskTurns = (runs: readonly TaskRun[], taskId: string) =>
  runs
    .filter((run) => run.taskId === taskId)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));

export const isRewound = (run: TaskRun | undefined) => !!run?.rewind?.rewound;

/**
 * Whether "Edit from here" is offered on `run`'s turn. Agents that cannot return their
 * conversation to an earlier turn, and work outside a worktree Jackalope made, never get
 * it; Claude Code and Codex turns that cannot be rewound say why.
 */
export function rewindOption(runs: readonly TaskRun[], run: TaskRun): RewindOption {
  if (
    isRewound(run) ||
    run.nonCode ||
    !run.workspace ||
    samePath(run.workspace, run.projectPath) ||
    !REWINDABLE.has(adapterOf(run)) ||
    isActive(run)
  )
    return { state: 'hidden' };
  const turns = taskTurns(runs, run.taskId);
  if (turns.some((turn) => isActive(turn) || turn.finishing))
    return { state: 'disabled', reason: 'Stop the running turn before rewinding.' };
  if (run.remote || turns.some((turn) => turn.remote))
    return { state: 'disabled', reason: 'Part of this work ran on a computer.' };
  if (run.retryOf)
    return {
      state: 'disabled',
      reason: 'This turn retried an earlier one. Rewind to the turn it retried.',
    };
  if (!run.rewind?.checkpoint)
    return {
      state: 'disabled',
      reason: run.rewind?.checkpointError
        ? `Jackalope could not save the files when this turn started: ${run.rewind.checkpointError}`
        : 'Jackalope saved no copy of the files when this turn started.',
    };
  const effect = turns.filter((turn) => !isRewound(turn));
  const previous = effect[effect.findIndex((turn) => turn.id === run.id) - 1];
  if (previous) {
    const mark = previous.rewind?.mark;
    if (!mark || mark.session !== previous.sessionId || adapterOf(previous) !== adapterOf(run))
      return {
        state: 'disabled',
        reason:
          'Jackalope did not record where the conversation stood after the turn before this one.',
      };
  } else if (run.continues) {
    return {
      state: 'disabled',
      reason: 'This conversation continues a session from outside Jackalope.',
    };
  }
  return { state: 'available' };
}

/** The rewind that Undo can reverse: kept on the latest attempt until the next turn starts. */
export function pendingRewind(runs: readonly TaskRun[], taskId: string): Rewind | null {
  const latest = taskTurns(runs, taskId).at(-1);
  const applied = latest?.rewind?.applied;
  return applied && !applied.undoneAt ? applied : null;
}

const turns = (count: number) => `${count} ${count === 1 ? 'turn' : 'turns'}`;

/** The confirmation's explanation of what a rewind will do. */
export function describeRewind(preview: RewindPreview) {
  const undone =
    preview.undone === 1
      ? `This will undo turn ${preview.turn}`
      : `This will undo ${turns(preview.undone)} (turns ${preview.turn} to ${preview.turn + preview.undone - 1})`;
  const files =
    preview.turn === 1
      ? 'restore files to how they were before the first turn'
      : `restore files to how they were after turn ${preview.turn - 1}`;
  const conversation =
    preview.conversation === 'new'
      ? 'The next message starts a new conversation with the agent.'
      : `${preview.conversation === 'claude' ? 'Claude Code' : 'Codex'} continues from the end of turn ${preview.turn - 1}, without the undone turns; its original conversation stays saved.`;
  return {
    summary: `${undone} and ${files}. Uncommitted changes made since will be kept in a safety snapshot.`,
    conversation,
    prompt: `Turn ${preview.turn}'s message goes back in the composer for you to edit and send. The undone turns stay in the transcript, collapsed.`,
    undo: 'Undo is available until you send the next message.',
  };
}

/** Consecutive transcript entries grouped so rewound turns can collapse together. */
export function groupRewound<T>(
  items: readonly T[],
  rewound: (item: T) => boolean,
): { rewound: boolean; items: T[] }[] {
  const groups: { rewound: boolean; items: T[] }[] = [];
  for (const item of items) {
    const flag = rewound(item);
    const last = groups.at(-1);
    if (last && last.rewound === flag) last.items.push(item);
    else groups.push({ rewound: flag, items: [item] });
  }
  return groups;
}
