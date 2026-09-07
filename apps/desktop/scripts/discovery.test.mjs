import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoverCodebaseContext,
  parseConventions,
  parseMarkdownTasks,
  parseRoadmapItems,
} from '../src/lib/context/discovery.ts';
import { appendRepoTodo, parseRepoTodos, updateRepoTodo } from '../src/lib/repo-todos.ts';
import { assemblePrompt } from '../src/lib/skills/context-assembler.ts';

test('TODO editing preserves Markdown, nested tasks, CRLF and unrelated lines', () => {
  const source =
    '\uFEFF# Plan\r\nIntro **unchanged**.\r\n## Next\r\n* [ ] **Ship** it\r\n  + [X] Nested\r\n\r\n## Later\r\n1. [ ] Follow up';
  const items = parseRepoTodos(source);
  assert.equal(items.length, 3);
  assert.equal(items[0].section, 'Next');
  assert.equal(items[1].depth, 2);
  assert.equal(items[1].completed, true);
  assert.equal(items[2].section, 'Later');
  const checked = updateRepoTodo(source, 3, { completed: true });
  assert.equal(checked, source.replace('* [ ]', '* [x]'));
  assert.equal(
    updateRepoTodo(checked, 3, { title: 'Ship [release](./release.md)' }),
    checked.replace('**Ship** it', 'Ship [release](./release.md)'),
  );
  assert.equal(appendRepoTodo(source, 'New step'), `${source}\r\n- [ ] New step\r\n`);
  assert.throws(() => updateRepoTodo(source, 1, { completed: true }));
  assert.throws(() => updateRepoTodo(source, 3, { title: 'two\nlines' }));
  assert.throws(() => appendRepoTodo(source, ' '));
});

test('code examples are excluded, including longer and mismatched fences', () => {
  const source =
    '# Tasks\n````md\n- [ ] Example\n```\n- [x] Still an example\n````\n~~~\n- [ ] Another example\n~~~\n- [ ] Real task\n';
  assert.deepEqual(
    parseRepoTodos(source).map((item) => item.title),
    ['Real task'],
  );
  assert.throws(() => updateRepoTodo(source, 2, { completed: true }));
  assert.throws(() => appendRepoTodo('```md\n- [ ] Example\n', 'Hidden item'));
  assert.equal(parseRepoTodos(appendRepoTodo(source, 'New task')).length, 2);
});

test('discovery reads every supported list and preserves the actual source path', async () => {
  const files = {
    'TODO.md': '',
    'docs/TODO.md': '- [ ] Docs task',
    'TASKS.md': '- [ ] Root task',
    'docs/TASKS.md': '- [x] Completed task',
    'ROADMAP.md': '# Planned\n- Roadmap note\n- [ ] Roadmap task',
    'docs/ROADMAP.md': '- [ ] Future task',
  };
  const result = await discoverCodebaseContext(
    { projectId: 'todo-project', projectName: 'Lists', projectPath: '/fixture' },
    async (path) => files[path] ?? null,
  );
  assert.equal(result.openTasks.length, 5);
  assert.equal(
    result.openTasks.find((item) => item.title === 'Docs task').sourceFile,
    'docs/TODO.md',
  );
  assert.ok(result.sourceFilesDetected.includes('TODO.md'));
  assert.ok(result.roadmapItems.includes('Roadmap note'));
  assert.equal(new Set(result.openTasks.map((item) => item.id)).size, 5);
});

test('repository discovery preserves tasks, conventions, stack and assembled context', async () => {
  const sampleTodo = `
# Implementation backlog
- [ ] Central connection catalog and quota routing
- [ ] Richer verification presentation
- [x] Shared themed selects across forms
- [ ] Clean visual audit log with per-project filter
`;
  const tasks = parseMarkdownTasks(sampleTodo, 'TODO.md');
  assert.equal(tasks.length, 4);
  assert.equal(tasks.filter((t) => t.status === 'open').length, 3);
  assert.equal(tasks.filter((t) => t.status === 'completed').length, 1);
  assert.equal(tasks[0].title, 'Central connection catalog and quota routing');

  const sampleRoadmap = `
# Status
## Next delivery
1. Real-time failover monitoring and automatic re-routing
2. Bounded proactive codebase memory discovery
3. Visual audit log
`;
  const roadmap = parseRoadmapItems(sampleRoadmap);
  assert.ok(roadmap.length >= 3);
  assert.ok(roadmap[0].includes('failover monitoring'));

  const sampleAgents = `
# Invariants
- Active Working User Only for commits
- Dynamic theming via CSS variables (--color-accent)
- Flat surface hierarchy with subtle gradients
- Run pnpm build before concluding turn
`;
  const conventions = parseConventions(sampleAgents);
  assert.ok(conventions.length >= 3);

  const mockFiles = {
    'package.json': JSON.stringify({
      name: 'test-project',
      description: 'A test project for discovery',
      scripts: { build: 'vite build', test: 'vitest run' },
      dependencies: { react: '^19.0.0', '@tauri-apps/api': '^2.0.0' },
      devDependencies: { tailwindcss: '^3.4.0', typescript: '^5.7.0' },
    }),
    'Cargo.toml': `[package]\nname = "test-desktop"\n[dependencies]\ntauri = "2.0"\ntokio = "1.0"`,
    'TODO.md': sampleTodo,
    'STATUS.md': sampleRoadmap,
    'AGENTS.md': sampleAgents,
  };

  const discovered = await discoverCodebaseContext(
    { projectId: 'p1', projectName: 'Test Project', projectPath: '/mock/path' },
    async (relPath) => mockFiles[relPath] ?? null,
  );

  assert.equal(discovered.projectId, 'p1');
  assert.ok(discovered.techStack.includes('React'));
  assert.ok(discovered.techStack.includes('Tauri v2'));
  assert.ok(discovered.techStack.includes('Tailwind CSS'));
  assert.ok(discovered.techStack.includes('Rust'));
  assert.equal(discovered.openTasks.filter((t) => t.status === 'open').length, 3);
  assert.ok(discovered.conventions.length >= 3);
  assert.equal(discovered.tokenUsageEstimate, 0); // 0 LLM tokens!

  const assembled = assemblePrompt({
    rawPrompt: 'Build the audit log component',
    projectRules: [
      ...discovered.conventions.slice(0, 3),
      `Tech Stack: ${discovered.techStack.join(', ')}`,
    ],
    executionMode: 'isolated',
  });

  assert.ok(assembled.hasSupplementation);
  assert.ok(assembled.assembledPrompt.includes('### 🎯 Objective\nBuild the audit log component'));
  assert.ok(assembled.assembledPrompt.includes('### 📋 Project Rules'));
  assert.ok(assembled.assembledPrompt.includes('Active Working User Only'));
  assert.ok(assembled.assembledPrompt.includes('Tech Stack:'));
  assert.ok(assembled.assembledPrompt.includes('React'));
  assert.ok(assembled.assembledPrompt.includes('Tauri v2'));
});
