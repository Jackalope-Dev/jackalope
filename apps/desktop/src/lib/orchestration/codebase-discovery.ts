import { useAgentConfigStore } from '../../stores/agentConfigStore.ts';
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
  const lines = content.split('\n');
  const tasks: OpenTaskItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    // Matches `- [ ] Task title` or `* [ ] Task title`
    const openMatch = line.match(/^[-*]\s+\[\s\]\s+(.+)$/);
    if (openMatch && openMatch[1]) {
      tasks.push({
        id: `${filename}-${i}`,
        title: openMatch[1].replace(/\*\*/g, '').trim(),
        sourceFile: filename,
        status: 'open',
      });
      continue;
    }

    // Matches `- [x] Task title` or `* [x] Task title`
    const doneMatch = line.match(/^[-*]\s+\[[xX]\]\s+(.+)$/);
    if (doneMatch && doneMatch[1]) {
      tasks.push({
        id: `${filename}-${i}`,
        title: doneMatch[1].replace(/\*\*/g, '').trim(),
        sourceFile: filename,
        status: 'completed',
      });
    }
  }

  return tasks;
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
      const clean = trimmed.replace(/^[-*]\s+/, '').replace(/\*\*/g, '').trim();
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
      if (numMatch && numMatch[1] && items.length < 8) {
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
        const clean = trimmed.replace(/^[-*]\s+/, '').replace(/\*\*/g, '').trim();
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

  // Default mock files for browser preview / testing when fileReader not provided
  const read =
    fileReader ??
    (async (relPath: string) => {
      // In web mock environment or fallback:
      if (relPath === 'package.json') {
        return JSON.stringify({
          name: projectName,
          scripts: { build: 'tsc -b && vite build', dev: 'vite', test: 'vitest run' },
          dependencies: { react: '^19.0.0', 'lucide-react': '^0.470.0', '@tauri-apps/api': '^2.0.0' },
          devDependencies: { tailwindcss: '^3.4.0', typescript: '^5.7.0', vite: '^6.0.0' },
        });
      }
      if (relPath === 'Cargo.toml') {
        return `[package]\nname = "${projectName}-desktop"\nversion = "0.1.0"\n[dependencies]\ntauri = "2.0"\ntokio = "1.0"\nserde = "1.0"`;
      }
      if (relPath === 'AGENTS.md') {
        return `# Invariants\n- Active Working User Only for commits\n- Dynamic theming via CSS variables (--color-accent)\n- Flat surface hierarchy with subtle gradients\n- Run pnpm build before concluding turn`;
      }
      if (relPath === 'TODO.md') {
        return `# Implementation backlog\n- [ ] Central connection catalog and quota routing\n- [ ] Richer verification presentation\n- [x] Shared themed selects across forms\n- [ ] Clean visual audit log with per-project filter`;
      }
      if (relPath === 'STATUS.md') {
        return `# Status\n## Next delivery\n1. Real-time failover monitoring and automatic re-routing\n2. Bounded proactive codebase memory discovery\n3. Visual audit log`;
      }
      return null;
    });

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

  // 4. Inspect TODO.md / STATUS.md
  const todoContent = await read('TODO.md');
  if (todoContent) {
    sourceFilesDetected.push('TODO.md');
    const parsed = parseMarkdownTasks(todoContent, 'TODO.md');
    openTasks.push(...parsed);
  }

  const statusContent = await read('STATUS.md');
  if (statusContent) {
    sourceFilesDetected.push('STATUS.md');
    const roadmap = parseRoadmapItems(statusContent);
    roadmapItems.push(...roadmap);
    for (const c of parseConventions(statusContent)) {
      conventions.add(c);
    }
  }

  // Fallback defaults if empty
  if (conventions.size === 0) {
    conventions.add('Preserve existing comments and project invariants.');
    conventions.add('Ensure all builds and typechecks pass before committing.');
  }

  const duration = Date.now() - startTime;
  const metaAgent = useAgentConfigStore.getState().defaultMetaAgent;

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
  };
}
