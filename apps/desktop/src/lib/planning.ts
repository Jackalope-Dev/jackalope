import type { TaskTicket } from '../stores/taskStore.ts';
import { VETTED_SKILLS } from './skills/catalog.ts';
import { assemblePrompt } from './skills/context-assembler.ts';

export function planningDraft(
  task: Pick<TaskTicket, 'rawPrompt' | 'refinedPrompt' | 'assignedAgent' | 'clarifications'>,
) {
  const isolated = !task.clarifications?.some(
    (item) => item.question === 'Git Execution Mode' && item.answer === 'Active working checkout',
  );
  const selectedNames =
    task.clarifications
      ?.find((item) => item.question === 'Active Skill Guidelines')
      ?.answer?.split(', ') ?? [];
  const skills = VETTED_SKILLS.filter((skill) => selectedNames.includes(skill.name)).map(
    (skill) => skill.id,
  );
  const generated = assemblePrompt({
    rawPrompt: task.rawPrompt,
    selectedSkillIds: skills,
    executionMode: isolated ? 'isolated' : 'current',
  }).assembledPrompt;
  const structured = !!task.refinedPrompt && task.refinedPrompt === generated;
  return {
    prompt: structured ? task.rawPrompt : task.refinedPrompt || task.rawPrompt,
    skills: structured ? skills : [],
    agent: task.assignedAgent === 'Unassigned' ? '' : (task.assignedAgent ?? ''),
    isolated,
  };
}

export function isCronExpression(value: string): boolean {
  const fields = value.trim().split(/\s+/);
  const limits = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ];
  return (
    fields.length === 5 &&
    fields.every((field, index) =>
      field.split(',').every((part) => {
        const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
        if (!match) return false;
        const [min, max] = limits[index];
        if (match[2] && (Number(match[2]) < 1 || Number(match[2]) > max - min + 1)) return false;
        if (match[1] === '*') return true;
        const [start, end = start] = match[1].split('-').map(Number);
        return start >= min && end <= max && start <= end;
      }),
    )
  );
}

export function scheduleProject<T extends { id: string }>(
  schedule: { targetProjectId: string },
  projects: T[],
): T | undefined {
  return projects.find((project) => project.id === schedule.targetProjectId);
}
