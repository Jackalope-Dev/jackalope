import { getSkillById } from './catalog.ts';
import { getToolById } from './tool-registry.ts';

export interface PromptAssemblyOptions {
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
 * Assembles a user's task prompt with transparent, opt-in guidelines and capabilities.
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
      for (const rule of skill.guidelines) {
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
      'Execute all changes in an isolated git worktree branch (.worktrees/<slug>).',
    );
  }

  // Collect active tools
  const activeTools = selectedToolIds
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
  sections.push(`### 🎯 Objective\n${trimmedRaw}`);

  // 2. Project Rules if present
  if (hasProjectRules) {
    const rulesBlock = projectRules.map((r) => `- ${r}`).join('\n');
    sections.push(`### 📋 Project Rules\n${rulesBlock}`);
  }

  // 3. Workflow Guidelines & Constraints
  if (hasSkills) {
    const guidelinesBlock = Array.from(skillGuidelines)
      .map((g) => `- ${g}`)
      .join('\n');
    sections.push(`### 📐 Guidelines & Quality Constraints\n${guidelinesBlock}`);
  }

  // 4. Attached Capabilities / Tools
  if (hasTools) {
    const toolsBlock = activeTools
      .map((t) => `- **${t.name}**: ${t.description} (Capabilities: ${t.capabilities.join(', ')})`)
      .join('\n');
    sections.push(`### 🛠️ Active Tools & Capabilities\n${toolsBlock}`);
  }

  return {
    assembledPrompt: sections.join('\n\n'),
    activeSkillCount: selectedSkillIds.length,
    activeToolCount: activeTools.length,
    hasSupplementation: true,
  };
}
