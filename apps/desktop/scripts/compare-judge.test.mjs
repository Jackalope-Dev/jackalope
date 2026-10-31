import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCombinePrompt,
  buildJudgePrompt,
  isRetainedWorkspace,
  parseVerdict,
  pickJudgeAgent,
  retainedWorkspaces,
} from '../src/lib/compare-judge.ts';

const attempt = (label, extra = {}) => ({
  label,
  agentName: label === 'A' ? 'Codex' : 'Claude Code',
  workspace: `C:/repo/.worktrees/attempt-${label}`,
  branch: `jackalope/attempt-${label}`,
  baseHead: 'abc123',
  files: [`src/${label}.ts`],
  patch: `+export const ${label} = 1;`,
  ...extra,
});

const verdictAnswer = (json) =>
  `Reasoning first.\n\n\`\`\`jackalope-verdict\n${JSON.stringify(json)}\n\`\`\``;

test('the judge defaults to a family none of the attempts used', () => {
  const candidates = [
    { id: 'codex', adapter: 'codex' },
    { id: 'my-claude', adapter: 'claude' },
    { id: 'grok', adapter: 'grok' },
  ];
  assert.deepEqual(pickJudgeAgent(candidates, ['codex', 'claude']), {
    id: 'grok',
    independent: true,
  });
  assert.deepEqual(pickJudgeAgent(candidates, ['codex', 'claude', 'grok']), {
    id: 'codex',
    independent: false,
  });
  assert.equal(pickJudgeAgent([], ['codex']), undefined);
});

test('the judge request is read-only, criteria-first and points at each worktree', () => {
  const prompt = buildJudgePrompt('Add a dark mode toggle', [attempt('A'), attempt('B')]);
  assert.match(prompt, /Do not edit files/);
  assert.match(prompt, /Add a dark mode toggle/);
  assert.match(prompt, /criteria[\s\S]*Base them on the request alone/);
  assert.match(prompt, /git -C "C:\/repo\/.worktrees\/attempt-B" diff abc123/);
  assert.match(prompt, /src\/A\.ts/);
  assert.match(prompt, /```jackalope-verdict/);
  assert.match(prompt, /labels A, B/);
});

test('long patches are cut and say where the rest is', () => {
  const prompt = buildJudgePrompt('Refactor', [
    attempt('A', { patch: `${'x'.repeat(20_000)}TAIL` }),
    attempt('B'),
  ]);
  assert.match(prompt, /excerpt; read the worktree for the rest/);
  assert.ok(!prompt.includes('TAIL'));
});

test('a verdict becomes a table with a base and ports from other attempts', () => {
  const verdict = parseVerdict(
    verdictAnswer({
      criteria: [
        { id: 'C1', text: 'Toggle persists' },
        { id: 'C2', text: 'Keyboard accessible' },
      ],
      scores: {
        A: { C1: { score: 5, note: 'Saved' }, C2: { score: 9 } },
        B: { C1: 2, C2: { score: 0 } },
        Z: { C1: 3 },
      },
      base: { attempt: 'A', reason: 'Smaller surface' },
      ports: [
        { from: 'B', what: 'Focus ring styles', files: ['src/theme.css'] },
        { from: 'A', what: 'Self port' },
        { from: 'Q', what: 'Unknown attempt' },
      ],
      ambiguous: null,
    }),
    ['A', 'B'],
  );
  assert.ok(verdict);
  assert.equal(verdict.criteria.length, 2);
  assert.deepEqual(verdict.scores.A.C1, { score: 5, note: 'Saved' });
  assert.equal(verdict.scores.A.C2.score, 5);
  assert.equal(verdict.scores.B.C1.score, 2);
  assert.equal(verdict.scores.B.C2.score, 1);
  assert.equal(verdict.scores.Z, undefined);
  assert.deepEqual(verdict.base, { attempt: 'A', reason: 'Smaller surface' });
  assert.deepEqual(verdict.ports, [
    { attempt: 'B', what: 'Focus ring styles', files: ['src/theme.css'] },
  ]);
  assert.equal(verdict.ambiguous, undefined);
});

test('an ambiguous request returns a clearer prompt instead of a pick', () => {
  const verdict = parseVerdict(
    verdictAnswer({
      criteria: [{ id: 'C1', text: 'Matches the request' }],
      scores: {},
      base: null,
      ports: [],
      ambiguous: { reason: 'One added a page, one a dialog', clarifiedPrompt: 'Add a dialog…' },
    }),
    ['A', 'B'],
  );
  assert.equal(verdict?.base, undefined);
  assert.deepEqual(verdict?.ambiguous, {
    reason: 'One added a page, one a dialog',
    prompt: 'Add a dialog…',
  });
});

test('answers without a usable verdict fall back to the written answer', () => {
  assert.equal(parseVerdict('A is better.', ['A', 'B']), undefined);
  assert.equal(parseVerdict('```jackalope-verdict\n{not json\n```', ['A', 'B']), undefined);
  assert.equal(
    parseVerdict(verdictAnswer({ criteria: [], base: { attempt: 'A' } }), ['A', 'B']),
    undefined,
  );
  assert.equal(
    parseVerdict(verdictAnswer({ criteria: [{ text: 'x' }], base: { attempt: 'C' } }), ['A', 'B']),
    undefined,
  );
  const untagged = parseVerdict(
    `\`\`\`json\n${JSON.stringify({ criteria: [{ text: 'Works' }], base: { attempt: 'B' } })}\n\`\`\``,
    ['A', 'B'],
  );
  assert.equal(untagged?.base?.attempt, 'B');
  assert.equal(untagged?.criteria[0].id, 'C1');
});

test('the combine follow-up names each source, its files and how to read it', () => {
  const prompt = buildCombinePrompt([
    {
      attempt: 'B',
      what: 'Focus ring styles',
      files: ['src/theme.css'],
      agentName: 'Claude Code',
      workspace: 'C:/repo/.worktrees/attempt-B',
      branch: 'jackalope/attempt-B',
      baseHead: 'abc123',
    },
  ]);
  assert.match(prompt, /Focus ring styles/);
  assert.match(prompt, /From attempt B \(Claude Code\)/);
  assert.match(prompt, /Files: src\/theme\.css/);
  assert.match(
    prompt,
    /Source worktree: C:\/repo\/.worktrees\/attempt-B \(branch jackalope\/attempt-B\)/,
  );
  assert.match(prompt, /git -C "C:\/repo\/.worktrees\/attempt-B" diff abc123/);
  assert.match(prompt, /read-only/);
});

test('source worktrees stay retained until the combine follow-up finishes', () => {
  const comparisons = [
    {
      id: 'c',
      projectId: 'p',
      prompt: 'x',
      taskIds: ['base', 'source'],
      createdAt: '2026-01-01T00:00:00Z',
      combine: {
        baseTaskId: 'base',
        sources: [{ taskId: 'source', workspace: 'C:\\Repo\\.worktrees\\Attempt-B\\' }],
        draftedAt: '2026-01-01T01:00:00Z',
      },
    },
  ];
  const kept = {
    taskId: 'base',
    startedAt: '2026-01-01T00:10:00Z',
    status: 'review',
    workspace: '',
  };
  const followUp = (status) => ({ ...kept, startedAt: '2026-01-01T02:00:00Z', status });
  const draft = (text) => () => text;
  const retained = (runs, text) =>
    isRetainedWorkspace(
      retainedWorkspaces(comparisons, runs, draft(text)),
      'c:/repo/.worktrees/attempt-b',
    );
  assert.equal(retained([kept], 'Bring over the focus styles'), true);
  assert.equal(retained([kept], '   '), false);
  assert.equal(retained([kept, followUp('running')], ''), true);
  assert.equal(retained([kept, followUp('interrupted')], ''), true);
  assert.equal(retained([kept, followUp('review')], 'leftover'), false);
  assert.equal(retained([kept, followUp('failed')], ''), false);
  assert.equal(
    retainedWorkspaces([{ ...comparisons[0], combine: undefined }], [kept], draft('x')).size,
    0,
  );
});
