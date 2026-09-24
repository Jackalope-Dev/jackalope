import { isActive, type TaskRun } from './task-runtime.ts';

const ansiEscape = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

export function activityLine(text: string) {
  const exit = text.match(/\nExit: ([^\n]+)/);
  if (exit) {
    const code = Number(exit[1]);
    return Number.isInteger(code) && code !== 0
      ? `Command failed (exit ${code})`
      : 'Command finished';
  }
  return text.replace(ansiEscape, '').trim().split('\n')[0].slice(0, 240);
}

export function activityKind(
  text: string,
): 'attention' | 'read' | 'edit' | 'search' | 'check' | 'activity' {
  if (
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
  return {
    phase,
    current,
    kind: activityKind(current),
    since: run.progress?.startedAt || run.startedAt,
    recent: paused ? [] : [...new Set(recent.filter((line) => line !== current))].slice(-2),
  };
}
