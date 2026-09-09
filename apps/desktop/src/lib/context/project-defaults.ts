import type { ProjectPreferences } from '../../stores/projectStore.ts';

export interface ProjectDefaults {
  baseBranch?: string | null;
  prepareCommand?: string | null;
  verifyCommand?: string | null;
}

export function missingProjectDefaults(
  preferences: ProjectPreferences | undefined,
  defaults: ProjectDefaults | undefined,
): Partial<ProjectPreferences> {
  const missing: Partial<ProjectPreferences> = {};
  for (const key of ['baseBranch', 'prepareCommand', 'verifyCommand'] as const) {
    if (preferences?.[key] === undefined && defaults?.[key]) missing[key] = defaults[key];
  }
  return missing;
}
