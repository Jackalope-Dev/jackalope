import { getSkillById } from './catalog.ts';
import legacyGuidelines from './legacy-guidelines.json' with { type: 'json' };
import { getToolById } from './tool-registry.ts';
import versionTwoGuidelines from './version-two-guidelines.json' with { type: 'json' };

export const PROMPT_VERSION = 4;

export interface PromptAssemblyOptions {
  version?: number;
  rawPrompt: string;
  selectedSkillIds?: string[];
  customGuidelines?: string[];
  selectedToolIds?: string[];
  projectRules?: string[];
  executionMode?: 'isolated' | 'current';
}

export interface AssembledPromptResult {
  assembledPrompt: string;
  activeSkillCount: number;
  activeToolCount: number;
  hasSupplementation: boolean;
}

/**
 * Assembles a user's task prompt with inspectable guidelines and capabilities.
 * Invariant: The rawPrompt is never altered or replaced; supplemental context is purely additive.
 */
export function assemblePrompt(options: PromptAssemblyOptions): AssembledPromptResult {
  const {
    rawPrompt,
    selectedSkillIds = [],
    customGuidelines = [],
    selectedToolIds = [],
    projectRules = [],
    executionMode,
    version = PROMPT_VERSION,
  } = options;

  const trimmedRaw = rawPrompt.trim();
  if (!trimmedRaw) {
    return {
      assembledPrompt: '',
      activeSkillCount: 0,
      activeToolCount: 0,
      hasSupplementation: false,
    };
  }

  // Collect active skill guidelines (deduplicated)
  const skillGuidelines = new Set<string>();
  for (const skillId of selectedSkillIds) {
    const skill = getSkillById(skillId);
    if (skill) {
      const rules =
        version === 1
          ? ((legacyGuidelines as Record<string, string[]>)[skillId] ?? skill.guidelines)
          : version === 2 || version === 4
            ? ((versionTwoGuidelines as Record<string, string[]>)[skillId] ?? skill.guidelines)
            : skill.guidelines;
      const workflowRules =
        version === 4 && skillId === 'systematic-debugging'
          ? [
              'Inspect the affected code and establish the cause. Run a reproduction check before implementation only when its result is needed to choose the fix or explicit user or repository instructions require it.',
              'Preserve unrelated behavior and existing work. Complete the coherent implementation before batching required tests and builds in final verification.',
              'Verify the fix and affected boundaries, including repository-required checks. Repeat passing checks only after relevant changes, failures or unresolved concerns.',
            ]
          : rules;
      for (const rule of workflowRules) {
        skillGuidelines.add(rule);
      }
    }
  }

  // Add custom user guidelines
  for (const custom of customGuidelines) {
    if (custom.trim()) {
      skillGuidelines.add(custom.trim());
    }
  }

  // Add execution mode constraint if isolated
  if (executionMode === 'isolated') {
    skillGuidelines.add(
      version === 1
        ? 'Execute all changes in an isolated git worktree branch (.worktrees/<slug>).'
        : 'Jackalope assigns the isolated workspace. Work in that directory; do not create another worktree.',
    );
  }

  // Collect active tools
  const activeTools = [...new Set(selectedToolIds)]
    .map((id) => getToolById(id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  const hasSkills = skillGuidelines.size > 0;
  const hasTools = activeTools.length > 0;
  const hasProjectRules = projectRules.length > 0;

  // If no supplements are active, return the raw prompt as-is without formatting overhead
  if (!hasSkills && !hasTools && !hasProjectRules) {
    return {
      assembledPrompt: trimmedRaw,
      activeSkillCount: 0,
      activeToolCount: 0,
      hasSupplementation: false,
    };
  }

  const sections: string[] = [];

  // 1. Primary User Objective
  const compact = version === 3;
  sections.push(`${!compact ? '### 🎯 Objective' : 'Task'}\n${trimmedRaw}`);

  // 2. Project Rules if present
  if (hasProjectRules) {
    const rulesBlock = projectRules.map((r) => `- ${r}`).join('\n');
    sections.push(`${!compact ? '### 📋 Project Rules' : 'Project rules'}\n${rulesBlock}`);
  }

  // 3. Workflow Guidelines & Constraints
  if (hasSkills) {
    const guidelinesBlock = Array.from(skillGuidelines)
      .map((g) => `- ${g}`)
      .join('\n');
    const priority =
      version === 1 ? '' : 'Apply relevant guidance; explicit user instructions take precedence.\n';
    sections.push(
      `${!compact ? '### 📐 Guidelines & Quality Constraints' : 'Relevant guidance'}\n${priority}${guidelinesBlock}`,
    );
  }

  // 4. Attached Capabilities / Tools
  if (hasTools) {
    const toolsBlock = activeTools
      .map((t) => `- **${t.name}**: ${t.description} (Capabilities: ${t.capabilities.join(', ')})`)
      .join('\n');
    sections.push(
      `${!compact ? '### 🛠️ Active Tools & Capabilities' : 'Selected tools'}\n${toolsBlock}`,
    );
  }

  return {
    assembledPrompt: sections.join('\n\n'),
    activeSkillCount: selectedSkillIds.length,
    activeToolCount: activeTools.length,
    hasSupplementation: true,
  };
}
