import { detectSkillsFromPrompt, VETTED_SKILLS } from './catalog.ts';

export interface TaskContextDefaults {
  automaticTaskContext?: boolean;
  taskGuidelines?: string[];
}

export function resolveTaskGuidelines(
  prompt: string,
  selected: string[] | undefined,
  defaults: TaskContextDefaults = {},
): string[] {
  const ids = selected ?? [
    ...(defaults.taskGuidelines ?? []),
    ...(defaults.automaticTaskContext !== false
      ? detectSkillsFromPrompt(prompt).map((skill) => skill.id)
      : []),
  ];
  return VETTED_SKILLS.filter((skill) => ids.includes(skill.id)).map((skill) => skill.id);
}
