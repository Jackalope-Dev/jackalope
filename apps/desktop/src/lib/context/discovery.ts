import { useAgentConfigStore } from '../../stores/agentConfigStore.ts';
import { parseRepoTodos, TODO_FILES } from '../repo-todos.ts';
import { nativeTask } from '../task-runtime.ts';
import type { ProjectDefaults } from './project-defaults.ts';
import type { DiscoveredCodebaseMemory, OpenTaskItem } from './types.ts';

export interface DiscoveryOptions {
  projectId: string;
  projectName: string;
  projectPath: string;
  deterministicOnly?: boolean;
  maxTokens?: number;
}

/**
 * Extracts open and completed markdown tasks from file contents (e.g. TODO.md or STATUS.md).
 */
export function parseMarkdownTasks(content: string, filename: string): OpenTaskItem[] {
  return parseRepoTodos(content).map((item) => ({
    id: `${filename}-${item.line}`,
    title: item.title.replace(/\*\*/g, '').trim(),
    sourceFile: filename,
    status: item.completed ? 'completed' : 'open',
  }));
}

/**
 * Extracts roadmap items from lines in ROADMAP.md or STATUS.md
 */
export function parseRoadmapItems(content: string): string[] {
  const lines = content.split('\n');
  const items: string[] = [];
  let inRoadmapSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#+\s+(roadmap|upcoming|milestones|next steps|planned)/i.test(trimmed)) {
      inRoadmapSection = true;
      continue;
    }
    if (inRoadmapSection && /^#+\s+/.test(trimmed)) {
      inRoadmapSection = false;
    }
    if (inRoadmapSection && /^[-*]\s+/.test(trimmed)) {
      const clean = trimmed
        .replace(/^[-*]\s+/, '')
        .replace(/\*\*/g, '')
        .trim();
      if (clean && items.length < 15) {
        items.push(clean);
      }
    }
  }

  // Fallback: if no dedicated section found, grab numbered items under Next/TODO
  if (items.length === 0) {
    for (const line of lines) {
      const trimmed = line.trim();
      const numMatch = trimmed.match(/^\d+\.\s+(.+)$/);
      if (numMatch?.[1] && items.length < 8) {
        items.push(numMatch[1].replace(/\*\*/g, '').trim());
      }
    }
  }

  return items;
}

/**
 * Extracts invariant rules and conventions from AGENTS.md, .cursorrules, etc.
 */
export function parseConventions(content: string): string[] {
  const lines = content.split('\n');
  const conventions: string[] = [];
  let inConventionsSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^#+\s+.*(invariant|convention|rule|guideline|standard)/i.test(trimmed)) {
      inConventionsSection = true;
      continue;
    }
    if (inConventionsSection && /^#+\s+/.test(trimmed)) {
      inConventionsSection = false;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const isDirective = /(rule|invariant|must|never|always|guideline|convention|standard)/i.test(
        trimmed,
      );
      if (inConventionsSection || isDirective) {
        const clean = trimmed
          .replace(/^[-*]\s+/, '')
          .replace(/\*\*/g, '')
          .trim();
        if (clean && conventions.length < 15 && !conventions.includes(clean)) {
          conventions.push(clean);
        }
      }
    }
  }

  return conventions;
}

/**
 * Deterministic fast inspection of codebase manifest files.
 */
export async function discoverCodebaseContext(
  options: DiscoveryOptions,
  fileReader?: (relPath: string) => Promise<string | null>,
): Promise<DiscoveredCodebaseMemory> {
  const startTime = Date.now();
  const { projectId, projectName, projectPath } = options;

  const techStack: Set<string> = new Set();
  const buildCommands: Set<string> = new Set();
  const testCommands: Set<string> = new Set();
  const conventions: Set<string> = new Set();
  const openTasks: OpenTaskItem[] = [];
  const roadmapItems: string[] = [];
  const sourceFilesDetected: string[] = [];
  let summary = `${projectName} repository workspace`;

  const read =
    fileReader ??
    ((relativePath: string) =>
      nativeTask<string | null>('task_read_context', { projectPath, relativePath }));

  // 1. Inspect package.json
  const pkgContent = await read('package.json');
  if (pkgContent) {
    sourceFilesDetected.push('package.json');
    try {
      const pkg = JSON.parse(pkgContent);
      if (pkg.description) summary = pkg.description;
      if (pkg.scripts) {
        if (pkg.scripts.build) buildCommands.add(`pnpm run build (${pkg.scripts.build})`);
        if (pkg.scripts.test) testCommands.add(`pnpm test (${pkg.scripts.test})`);
      }
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      if (deps.react) techStack.add('React');
      if (deps.tailwindcss) techStack.add('Tailwind CSS');
      if (deps.typescript) techStack.add('TypeScript');
      if (deps['@tauri-apps/api']) techStack.add('Tauri v2');
      if (deps.vite) techStack.add('Vite');
      if (deps.next) techStack.add('Next.js');
      if (deps.vue) techStack.add('Vue.js');
      if (deps.svelte) techStack.add('Svelte');
    } catch {
      // ignore parse errors
    }
  }

  // 2. Inspect Cargo.toml
  const cargoContent = await read('Cargo.toml');
  if (cargoContent) {
    sourceFilesDetected.push('Cargo.toml');
    techStack.add('Rust');
    buildCommands.add('cargo check / cargo build');
    testCommands.add('cargo test');
    if (cargoContent.includes('tauri')) techStack.add('Tauri v2');
    if (cargoContent.includes('axum')) techStack.add('Axum Web');
    if (cargoContent.includes('tokio')) techStack.add('Tokio Async');
  }

  // 3. Inspect AGENTS.md
  const agentsContent = await read('AGENTS.md');
  if (agentsContent) {
    sourceFilesDetected.push('AGENTS.md');
    for (const c of parseConventions(agentsContent)) {
      conventions.add(c);
    }
  }

  for (const path of TODO_FILES) {
    const content = await read(path);
    if (content === null) continue;
    sourceFilesDetected.push(path);
    openTasks.push(...parseMarkdownTasks(content, path));
    if (path.endsWith('ROADMAP.md')) roadmapItems.push(...parseRoadmapItems(content));
  }

  for (const path of ['docs/STATUS.md', 'STATUS.md']) {
    const content = await read(path);
    if (content === null) continue;
    sourceFilesDetected.push(path);
    roadmapItems.push(...parseRoadmapItems(content));
    for (const convention of parseConventions(content)) conventions.add(convention);
    break;
  }

  const metaAgent = useAgentConfigStore.getState().defaultMetaAgent;
  const projectDefaults = fileReader
    ? undefined
    : await nativeTask<ProjectDefaults>('project_defaults', { path: projectPath }).catch(
        () => undefined,
      );
  const duration = Date.now() - startTime;

  return {
    projectId,
    projectName,
    projectPath,
    summary,
    techStack: Array.from(techStack),
    conventions: Array.from(conventions),
    openTasks,
    roadmapItems,
    buildCommands: Array.from(buildCommands),
    testCommands: Array.from(testCommands),
    lastScannedAt: new Date().toISOString(),
    tokenUsageEstimate: 0, // Deterministic extraction costs 0 LLM tokens!
    scanDurationMs: duration,
    sourceFilesDetected,
    metaAgent,
    projectDefaults,
  };
}
