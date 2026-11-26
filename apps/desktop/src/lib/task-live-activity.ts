import { isActive } from '@jackalope/contracts/runs';
import type { ThinkingOrbState } from '@jackalope/ui';
import type { StepProgress, TaskRun } from './run-types.ts';

const ansiEscape = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

function activityLine(text: string) {
  const exit = text.match(/\nExit: ([^\n]+)/);
  if (exit) {
    const code = Number(exit[1]);
    return Number.isInteger(code) && code !== 0
      ? `Command failed (exit ${code})`
      : 'Command finished';
  }
  return text.replace(ansiEscape, '').trim().split('\n')[0].slice(0, 240);
}

// A failed tool step from the native activity log, such as "Running pnpm failed: exit 1".
const failedStep =
  /^(running|reading|editing|writing|searching|using|finding|asking|starting|updating|tool request)\b.* failed(: .+)?$/i;

type ActivityKind = 'attention' | 'read' | 'edit' | 'search' | 'check' | 'activity';

function activityKind(text: string): ActivityKind {
  if (
    failedStep.test(text) ||
    /^(tool request failed|file change failed|command failed|error\b|permission denied)|(?: · |: )(failed|error|denied)$/i.test(
      text,
    )
  )
    return 'attention';
  if (/^(reading|using read)/i.test(text)) return 'read';
  if (/^(editing|writing|changed|using (edit|write))/i.test(text)) return 'edit';
  if (/search|using (grep|glob)/i.test(text)) return 'search';
  if (/compil|test|check|command|using (bash|powershell)/i.test(text)) return 'check';
  return 'activity';
}

/** The thinking orb that names what a working run is doing, from its step and latest activity. */
export function activityOrb(
  status: TaskRun['status'],
  progress?: Pick<StepProgress, 'step' | 'label'> | null,
  kind: ActivityKind = 'activity',
  finishing = false,
): ThinkingOrbState {
  const step = progress?.step;
  if (status === 'starting' || step === 'workspace' || step === 'dependencies') return 'connecting';
  if (step === 'routing' || /\bplan/i.test(progress?.label ?? '')) return 'planning';
  if (finishing || step === 'verification' || kind === 'check') return 'solving';
  if (kind === 'read' || kind === 'search') return 'searching';
  if (kind === 'edit') return 'composing';
  // Between named steps the agent is thinking; the ring reads more calmly than scattered orbits.
  return 'breathing';
}

export function liveActivity(run: TaskRun) {
  if (!isActive(run)) return null;
  const waiting = !run.finishing && run.prompts?.some((prompt) => prompt.status === 'pending');
  const paused = run.status === 'stopping' || waiting;
  const recent = run.activity
    .map(activityLine)
    .filter(Boolean)
    .filter((line, index, lines) => line !== lines[index - 1])
    .slice(-3);
  const phase =
    run.status === 'stopping'
      ? 'Stopping'
      : waiting
        ? 'Waiting for your answer'
        : run.progress?.label ||
          (run.finishing
            ? 'Checking result'
            : run.status === 'starting'
              ? 'Preparing workspace'
              : 'Working');
  const current = paused
    ? phase
    : run.progress
      ? activityLine(run.progress.detail || '') || phase
      : recent.at(-1) || phase;
  const kind = activityKind(current);
  return {
    phase,
    current,
    kind,
    /** Null while the run waits on the person or stops, when nothing is being worked on. */
    orb: paused ? null : activityOrb(run.status, run.progress, kind, run.finishing),
    since: run.progress?.startedAt || run.startedAt,
    recent: paused ? [] : [...new Set(recent.filter((line) => line !== current))].slice(-2),
  };
}
