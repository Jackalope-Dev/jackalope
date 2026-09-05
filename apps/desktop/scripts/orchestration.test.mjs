import assert from 'node:assert/strict';
import {
  detectTaskIntent,
  estimateComplexity,
  determineBestRoute,
} from '../src/lib/orchestration/router.ts';
import {
  FALLBACK_CHAINS,
  AGENT_MODELS,
  getModelById,
  getDefaultModelForRunner,
} from '../src/lib/orchestration/model-catalog.ts';
import {
  parseMarkdownTasks,
  parseRoadmapItems,
  parseConventions,
  discoverCodebaseContext,
} from '../src/lib/orchestration/codebase-discovery.ts';
import { assemblePrompt } from '../src/lib/skills/context-assembler.ts';

console.log('--- 🧪 Running Jackalope Orchestration & Discovery Test Suite ---');

// 1. Test Task Intent Detection
console.log('1. Testing Intent & Complexity Classification...');
assert.equal(detectTaskIntent('Refactor the state management architecture'), 'refactoring');
assert.equal(detectTaskIntent('Fix the bug where task crashes on restart'), 'debugging');
assert.equal(detectTaskIntent('Add unit tests for router and discovery'), 'testing');
assert.equal(detectTaskIntent('Document the API conventions in README'), 'documentation');
assert.equal(detectTaskIntent('Create a new visual dashboard component'), 'feature');

assert.equal(estimateComplexity('Fix typo in button'), 'trivial');
assert.equal(
  estimateComplexity('Refactor the state store across multiple files and backend and frontend components'),
  'complex'
);
console.log('   ✓ Intent and complexity detection passed.');

// 2. Test Model Catalog & Fallback Chains
console.log('2. Testing Model Catalog & Fallback Chains...');
assert.ok(AGENT_MODELS.length >= 8);
assert.equal(getDefaultModelForRunner('codex').id, 'o3-mini');
assert.equal(getDefaultModelForRunner('claude').id, 'claude-3-7-sonnet');
assert.equal(getDefaultModelForRunner('grok').id, 'grok-3');

assert.equal(FALLBACK_CHAINS.codex[0].agent, 'claude');
assert.equal(FALLBACK_CHAINS.claude[0].agent, 'codex');
assert.equal(FALLBACK_CHAINS.grok[0].agent, 'claude');
console.log('   ✓ Model catalog and fallback chains verified.');

// 3. Test Intelligent Best-Fit Routing
console.log('3. Testing Intelligent Best-Fit Routing...');
const mockRunners = [
  { id: 'codex', name: 'Codex', available: true, signedIn: true },
  { id: 'claude', name: 'Claude Code', available: true, signedIn: true },
  { id: 'grok', name: 'Grok', available: true, signedIn: true },
];

// Complex multi-file refactoring should pick Claude 3.7 Sonnet
const refactorDecision = determineBestRoute({
  prompt: 'Refactor the theme engine across multiple files and components for monorepo consistency',
  availableRunners: mockRunners,
  preference: 'quality',
});
assert.equal(refactorDecision.chosenAgent, 'claude');
assert.equal(refactorDecision.chosenModel, 'claude-3-7-sonnet');
assert.equal(refactorDecision.detectedIntent, 'refactoring');
assert.ok(refactorDecision.explanation.includes('Claude 3.7 Sonnet'));

// Algorithmic / logic task should pick o3-mini or Claude
const algoDecision = determineBestRoute({
  prompt: 'Optimize concurrency and fix deadlock algorithm in task scheduler',
  availableRunners: mockRunners,
  preference: 'speed',
});
assert.ok(['codex', 'claude'].includes(algoDecision.chosenAgent));

// Test manual override
const overrideDecision = determineBestRoute({
  prompt: 'Any prompt',
  availableRunners: mockRunners,
  forcedAgent: 'grok',
});
assert.equal(overrideDecision.chosenAgent, 'grok');
assert.equal(overrideDecision.isManualOverride, true);

// Test failover penalty: if Claude recently failed, router should avoid Claude
const penaltyDecision = determineBestRoute({
  prompt: 'Refactor the database schema across multiple files',
  availableRunners: mockRunners,
  recentFailovers: [{ agent: 'claude', timestamp: Date.now() }],
});
assert.notEqual(penaltyDecision.chosenAgent, 'claude');
console.log('   ✓ Intelligent best-fit routing and failover penalties verified.');

// 4. Test Codebase Discovery Deterministic Parsing
console.log('4. Testing Codebase Discovery Parsing...');
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
console.log('   ✓ Markdown tasks, roadmap items, and conventions parsing verified.');

// 5. Test Full discoverCodebaseContext
console.log('5. Testing Full discoverCodebaseContext...');
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
  async (relPath) => mockFiles[relPath] ?? null
);

assert.equal(discovered.projectId, 'p1');
assert.ok(discovered.techStack.includes('React'));
assert.ok(discovered.techStack.includes('Tauri v2'));
assert.ok(discovered.techStack.includes('Tailwind CSS'));
assert.ok(discovered.techStack.includes('Rust'));
assert.equal(discovered.openTasks.filter((t) => t.status === 'open').length, 3);
assert.ok(discovered.conventions.length >= 3);
assert.equal(discovered.tokenUsageEstimate, 0); // 0 LLM tokens!
console.log('   ✓ Full codebase context discovery verified.');

// 6. Test Prompt Assembly with Discovered Conventions
console.log('6. Testing Prompt Assembly with Injected Memory...');
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
console.log('   ✓ Prompt assembly preserves raw intent and transparently injects repo memory.');

// 7. Test User Agent Enablement & Model Restrictions
console.log('7. Testing Agent Enablement & Model Restrictions in Router...');
const { useAgentConfigStore } = await import('../src/stores/agentConfigStore.ts');
const agentStore = useAgentConfigStore.getState();

// Disable Claude
agentStore.toggleAgent('claude', false);
assert.equal(agentStore.isAgentEnabled('claude'), false);

const noClaudeDecision = determineBestRoute({
  prompt: 'Refactor the theme engine across multiple files',
  availableRunners: mockRunners,
  preference: 'quality',
});
assert.notEqual(noClaudeDecision.chosenAgent, 'claude');
console.log('   ✓ Router strictly excludes disabled agent (Claude).');

// Re-enable Claude, but restrict Claude 3.7 Sonnet
agentStore.toggleAgent('claude', true);
agentStore.toggleModel('claude-3-7-sonnet', false);
assert.equal(agentStore.isModelAllowed('claude-3-7-sonnet'), true ? false : false);

const restrictedModelDecision = determineBestRoute({
  prompt: 'Refactor the theme engine across multiple files',
  availableRunners: mockRunners,
  preference: 'quality',
});
assert.notEqual(restrictedModelDecision.chosenModel, 'claude-3-7-sonnet');
console.log('   ✓ Router strictly excludes restricted model (claude-3-7-sonnet).');

// Restore model
agentStore.toggleModel('claude-3-7-sonnet', true);

// 8. Test Default Meta-Agent & Custom Agent Registration
console.log('8. Testing Default Meta-Agent & Custom Agent Registration...');
agentStore.setDefaultMetaAgent('codex');
assert.equal(useAgentConfigStore.getState().defaultMetaAgent, 'codex');

agentStore.addCustomAgent({
  id: 'ollama-qwen',
  name: 'Local Ollama Qwen',
  command: 'ollama run qwen2.5-coder',
  description: 'Local private coding runner',
  models: [{ id: 'qwen-32b', name: 'Qwen 2.5 Coder 32B' }],
  enabled: true,
});

assert.ok(useAgentConfigStore.getState().customAgents.some((a) => a.id === 'ollama-qwen'));
assert.equal(useAgentConfigStore.getState().isAgentEnabled('ollama-qwen'), true);

const customRunners = [
  ...mockRunners,
  { id: 'ollama-qwen', name: 'Local Ollama Qwen', available: true, signedIn: true },
];

const customRoute = determineBestRoute({
  prompt: 'Any prompt',
  availableRunners: customRunners,
  forcedAgent: 'ollama-qwen',
});
assert.equal(customRoute.chosenAgent, 'ollama-qwen');
console.log('   ✓ Default meta-agent configuration and custom agents verified.');

console.log('\n🎉 ALL ORCHESTRATION, DISCOVERY & AGENT CONTROL TESTS PASSED CLEANLY!\n');
