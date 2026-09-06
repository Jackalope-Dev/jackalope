/**
 * Curated catalog of open source, public, and vetted prompts and agent skills.
 * Sources adapted from:
 * - Anthropic Agent Skills & Prompt Library (MIT / Apache 2.0)
 * - Daniel Miessler's Fabric patterns (MIT)
 * - Awesome Cursor Rules & cursor.directory (MIT)
 * - Aider System Prompts & Repo-Map patterns (Apache 2.0)
 * - SWE-agent Thought-Action-Observation loops (MIT)
 */

export type SkillCategory =
  | 'debugging'
  | 'feature'
  | 'refactor'
  | 'testing'
  | 'security'
  | 'performance'
  | 'git'
  | 'browser';

export interface SkillDefinition {
  id: string;
  name: string;
  shortLabel: string;
  iconName: string;
  description: string;
  category: SkillCategory;
  triggers: RegExp[];
  guidelines: string[];
  suggestedTools?: string[];
  defaultSelected?: boolean;
}

export const VETTED_SKILLS: SkillDefinition[] = [
  {
    id: 'systematic-debugging',
    name: 'Systematic Debugging & Triage',
    shortLabel: 'Debug & Triage',
    iconName: 'Bug',
    description:
      'Root-cause analysis requiring a minimal reproduction test before modifying production code.',
    category: 'debugging',
    triggers: [
      /\b(fix|bug|broken|crash|error|exception|fails?|failing|hang|regression|reproduce|trace|issue)\b/i,
    ],
    guidelines: [
      'Write a minimal failing reproduction test or script before touching production code.',
      'Trace the exact call path and inspect state; do not apply superficial patches or guess root causes.',
      'Touch only code directly relevant to the issue. Preserve adjacent logic, comments, and formatting.',
      'Verify that the reproduction test passes and all existing regression tests remain clean.',
    ],
    suggestedTools: ['filesystem', 'git'],
  },
  {
    id: 'feature-scaffolding',
    name: 'Feature Implementation & Accessible UI',
    shortLabel: 'Feature & UI',
    iconName: 'Sparkles',
    description:
      'Idiomatic scaffolding with strict typing, design token alignment, and accessible WAI-ARIA controls.',
    category: 'feature',
    triggers: [
      /\b(add|create|build|implement|feature|scaffold|new page|new component|modal|dialog|button|ui|endpoint)\b/i,
    ],
    guidelines: [
      'Follow existing project architectural conventions, directory layouts, and naming patterns.',
      'For UI components, use semantic HTML, accessible WAI-ARIA roles/states, and theme CSS variables.',
      'Ensure strict type safety across all boundaries; avoid loose any types or unchecked runtime assumptions.',
      'Validate that the project builds and typechecks cleanly with exit code 0.',
    ],
    suggestedTools: ['filesystem', 'browser'],
  },
  {
    id: 'clean-refactoring',
    name: 'Safe Refactoring & Modernization',
    shortLabel: 'Safe Refactor',
    iconName: 'RefreshCw',
    description:
      'Incremental restructuring preserving public API contracts and eliminating dead code without drift.',
    category: 'refactor',
    triggers: [
      /\b(refactor|clean\s*up|simplify|modernize|remove dead code|extract|decouple|prune|reorganize)\b/i,
    ],
    guidelines: [
      'Preserve identical public API contracts, return types, and observable side effects.',
      'Perform small, incremental transformations that can be individually verified.',
      'Remove confirmed dead imports, unused variables, and orphaned styles cleanly.',
      'Avoid running full-file reformatters that pollute git diffs with unrelated changes.',
    ],
    suggestedTools: ['filesystem', 'git'],
  },
  {
    id: 'tdd-verification',
    name: 'Test-Driven Development & Edge Cases',
    shortLabel: 'TDD & Tests',
    iconName: 'CheckCircle2',
    description:
      'Hermetic, order-independent test suites covering happy paths, boundaries, and failure modes.',
    category: 'testing',
    triggers: [
      /\b(test|tests|testing|tdd|unit test|integration test|e2e|coverage|spec|mock|snapshot)\b/i,
    ],
    guidelines: [
      'Ensure every test is hermetic, order-independent, and does not leak global state or open handles.',
      'Cover boundary conditions: empty inputs, maximum limits, malformed payloads, and network failures.',
      'Assert on observable behavior and contracts rather than internal implementation details.',
      'Keep assertions specific and descriptive so failure messages point directly to the cause.',
    ],
    suggestedTools: ['filesystem', 'browser'],
  },
  {
    id: 'security-audit',
    name: 'Security Review & Boundary Validation',
    shortLabel: 'Security Audit',
    iconName: 'ShieldAlert',
    description:
      'OWASP-aligned inspection preventing secret leaks, injection, and path traversal vulnerabilities.',
    category: 'security',
    triggers: [
      /\b(security|audit|vulnerability|cve|sanitize|auth|jwt|token|secret|leak|permission)\b/i,
    ],
    guidelines: [
      'Never log, persist, or commit API keys, auth tokens, passwords, or sensitive credentials.',
      'Validate and sanitize all external inputs, file paths, URLs, and IPC payloads against traversal or injection.',
      'Enforce least-privilege containment for spawned child processes and file access.',
      'Check third-party dependencies for known vulnerabilities and unpinned dynamic imports.',
    ],
    suggestedTools: ['filesystem', 'git'],
  },
  {
    id: 'performance-tuning',
    name: 'Performance Profiling & Resource Efficiency',
    shortLabel: 'Performance',
    iconName: 'Zap',
    description:
      'Quantified optimization eliminating O(N²) loops, redundant allocations, and unmanaged listeners.',
    category: 'performance',
    triggers: [
      /\b(perf|performance|slow|speed up|latency|memory|leak|cpu|profil|optimi[zs]e|bundle size)\b/i,
    ],
    guidelines: [
      'Establish a measurable baseline before making changes; verify improvement with concrete benchmarks.',
      'Avoid O(N²) iterations, redundant deep clones, and unbuffered streaming over IPC or network.',
      'Ensure all event listeners, timers, observer handles, and child processes are explicitly cleaned up.',
      'Keep bundle size and memory footprint minimal; avoid pulling large dependencies for simple helpers.',
    ],
    suggestedTools: ['filesystem'],
  },
  {
    id: 'git-coordination',
    name: 'Git Worktree & Safe Integration',
    shortLabel: 'Git Isolation',
    iconName: 'GitBranch',
    description:
      'Worktree isolation, clean conventional commits, and conflict-free integration into the selected target branch.',
    category: 'git',
    triggers: [
      /\b(git|worktree|branch|merge|rebase|conflict|pr|pull request|commit|cherry-pick)\b/i,
    ],
    guidelines: [
      'Work in the assigned task worktree. Do not create another worktree or modify the project checkout.',
      'Author commits exclusively under the active working user (never add bot or co-authored trailers).',
      'Write clear, imperative conventional commit messages (feat:, fix:, docs:, refactor:).',
      'Ensure the combined workspace builds and passes all checks before requesting integration.',
    ],
    suggestedTools: ['git'],
  },
  {
    id: 'ui-validation',
    name: 'UI Change & Visual Validation',
    shortLabel: 'Validate UI',
    iconName: 'Eye',
    description:
      'Headless browser automation, viewport screenshots, and DOM inspection for verifying UI changes.',
    category: 'browser',
    triggers: [
      /\b(validate ui|verify ui|visual test|screenshot|check component|ui change|appearance|layout|styling)\b/i,
    ],
    guidelines: [
      'Use browser_navigate to load the UI at http://localhost:5173 or the designated route.',
      'Capture visual screenshot evidence before and after changes using browser_screenshot.',
      'Record structured validation checkpoints using record_validation_step.',
      'Prompt the user proactively via ask_user if layout decisions or visual choices need review.',
    ],
    suggestedTools: ['browser', 'filesystem'],
  },
  {
    id: 'onboarding-flow',
    name: 'Onboarding Flow & User Journey Test',
    shortLabel: 'Test Onboarding',
    iconName: 'Workflow',
    description:
      'End-to-end user onboarding flow walkthrough, form inputs, step transitions, and interactive user prompts.',
    category: 'testing',
    triggers: [
      /\b(onboarding|signup flow|sign up|registration flow|welcome flow|user journey|walkthrough)\b/i,
    ],
    guidelines: [
      'Navigate step-by-step through the onboarding registration or welcome flow.',
      'Prompt the user proactively via ask_user for test credentials, bypass keys, or environment settings.',
      'Verify form error validation on invalid inputs and successful transition to the next step.',
      'Record each verified step via record_validation_step and capture screenshot evidence.',
    ],
    suggestedTools: ['browser', 'filesystem'],
  },
];

/**
 * Detects matching vetted skills from a raw prompt string using trigger patterns.
 */
export function detectSkillsFromPrompt(prompt: string): SkillDefinition[] {
  if (!prompt?.trim()) return [];
  const normalized = prompt.trim();
  return VETTED_SKILLS.filter((skill) => skill.triggers.some((regex) => regex.test(normalized)));
}

/**
 * Finds a skill by its unique identifier.
 */
export function getSkillById(id: string): SkillDefinition | undefined {
  return VETTED_SKILLS.find((s) => s.id === id);
}
