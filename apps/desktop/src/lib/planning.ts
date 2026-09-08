import type { TaskTicket } from '../stores/taskStore.ts';
import { VETTED_SKILLS } from './skills/catalog.ts';
import { assemblePrompt } from './skills/context-assembler.ts';

export function planningDraft(
  task: Pick<
    TaskTicket,
    | 'rawPrompt'
    | 'refinedPrompt'
    | 'assignedAgent'
    | 'clarifications'
    | 'connectionIds'
    | 'contextSelection'
  >,
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
    contextSelection: task.contextSelection,
    prompt: structured ? task.rawPrompt : task.refinedPrompt || task.rawPrompt,
    skills: structured ? skills : [],
    agent: task.assignedAgent === 'Unassigned' ? '' : (task.assignedAgent ?? ''),
    isolated,
    connectionIds: task.connectionIds,
  };
}
