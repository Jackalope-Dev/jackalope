import type { ProjectPreferences } from '../../stores/projectStore.ts';

export interface ProjectDefaults {
  baseBranch?: string | null;
  prepareCommand?: string | null;
  verifyCommand?: string | null;
  previewCommand?: string | null;
  /** The Xcode project or Swift package, when there is one. */
  xcode?: XcodeProject | null;
}

/** An Xcode project as native project detection reports it. */
interface XcodeProject {
  container: 'workspace' | 'project' | 'package';
  path: string | null;
  generator: 'xcodeGen' | 'tuist' | null;
  cocoapods: boolean;
  ios: boolean;
  scheme: string | null;
}

export function missingProjectDefaults(
  preferences: ProjectPreferences | undefined,
  defaults: ProjectDefaults | undefined,
): Partial<ProjectPreferences> {
  const missing: Partial<ProjectPreferences> = {};
  for (const key of ['baseBranch', 'prepareCommand', 'verifyCommand', 'previewCommand'] as const) {
    if (preferences?.[key] === undefined && defaults?.[key]) missing[key] = defaults[key];
  }
  return missing;
}
