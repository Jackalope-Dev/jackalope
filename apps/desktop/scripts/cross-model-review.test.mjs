import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReviewPrompt,
  getCachedReview,
  parseReviewResponse,
  requestCrossModelReview,
} from '../src/lib/cross-model-review.ts';

test('buildReviewPrompt embeds author agent, changed files and diff snapshot', () => {
  const prompt = buildReviewPrompt(
    'codex',
    ['src/commands/tokens.rs', 'src/lib/auth.ts'],
    '@@ -1,5 +1,5 @@\n-let old = 1;\n+let token = secret();',
  );

  assert.ok(prompt.includes('proposed by codex'));
  assert.ok(prompt.includes('src/commands/tokens.rs'));
  assert.ok(prompt.includes('src/lib/auth.ts'));
  assert.ok(prompt.includes('let token = secret();'));
  assert.ok(prompt.includes('VERDICT: [APPROVED | WARNING | CHANGES_REQUESTED]'));
});

test('parseReviewResponse extracts verdict, summary and categorized findings', () => {
  const raw = `
VERDICT: WARNING
SUMMARY: The backend changes are mostly sound but require additional credential safety checks.
FINDINGS:
- [SECURITY] [HIGH] Potential secret leak in debug log statement.
- [PERFORMANCE] [LOW] Array allocation inside tight loop could be avoided.
- [STYLE] [LOW] Variable name should follow snake_case convention.
`;

  const parsed = parseReviewResponse(raw, 'run-123', 'codex', 'Claude Code');
  assert.equal(parsed.runId, 'run-123');
  assert.equal(parsed.authorAgent, 'codex');
  assert.equal(parsed.reviewerAgent, 'Claude Code');
  assert.equal(parsed.verdict, 'warning');
  assert.ok(parsed.summary.includes('backend changes are mostly sound'));
  assert.equal(parsed.findings.length, 3);

  const sec = parsed.findings.find((f) => f.category === 'security');
  assert.ok(sec);
  assert.equal(sec.severity, 'high');
  assert.ok(sec.description.includes('Potential secret leak'));

  const perf = parsed.findings.find((f) => f.category === 'performance');
  assert.ok(perf);
  assert.equal(perf.severity, 'low');
});

test('parseReviewResponse defaults to approved when no issues are found', () => {
  const raw = `
VERDICT: APPROVED
SUMMARY: Clean, idiomatic Rust code with comprehensive error propagation.
FINDINGS:
`;

  const parsed = parseReviewResponse(raw, 'run-456', 'claude', 'Codex');
  assert.equal(parsed.verdict, 'approved');
  assert.equal(parsed.findings.length, 0);
});

test('requestCrossModelReview evaluates patches and caches results', async () => {
  const result = await requestCrossModelReview({
    runId: 'run-789',
    authorAgent: 'codex',
    reviewerAgent: 'Claude Code',
    files: ['src/commands/api.rs'],
    patch: '@@ -10 +10 @@\n+ let auth_token = std::env::var("SECRET").unwrap();',
  });

  assert.equal(result.runId, 'run-789');
  assert.equal(result.authorAgent, 'codex');
  assert.equal(result.reviewerAgent, 'Claude Code');
  // Should detect unwrap and token
  assert.equal(result.verdict, 'warning');
  assert.ok(result.findings.length >= 1);

  // Cached
  const cached = getCachedReview('run-789');
  assert.ok(cached);
  assert.equal(cached.runId, 'run-789');
});
