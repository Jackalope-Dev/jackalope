import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorEvidence,
  fixFollowUp,
  reviewBlock,
  reviewState,
  taskReviews,
} from '../src/lib/agent-review.ts';

const reply = (body) => `I read the change.\n\n\`\`\`jackalope-review\n${body}\n\`\`\``;

test('reads the last review block, normalizes fields and orders by severity', () => {
  const report = reviewBlock(
    reply(
      JSON.stringify({
        summary: ' Mostly fine. ',
        findings: [
          { severity: 'low', title: 'Typo', file: 'a.ts', line: 3, problem: 'p', fix: 'f' },
          {
            severity: 'HIGH',
            title: 'Data loss',
            file: 'b.ts',
            line: '12',
            problem: 'p',
            fix: 'f',
          },
          { severity: 'odd', problem: 'Missing check\nmore', fix: 'Add it', line: -1 },
          { title: 'Nothing to do' },
          'junk',
        ],
      }),
    ),
  );
  assert.equal(report.summary, 'Mostly fine.');
  assert.deepEqual(
    report.findings.map((item) => [item.severity, item.title, item.line]),
    [
      ['high', 'Data loss', 12],
      ['medium', 'Missing check', null],
      ['low', 'Typo', 3],
    ],
  );
});

test('a reply without a valid block has no report', () => {
  assert.equal(reviewBlock('No block here.'), undefined);
  assert.equal(reviewBlock(reply('{not json')), undefined);
  assert.equal(reviewBlock(reply('[]')).findings.length, 0);
  assert.deepEqual(reviewBlock(reply('{"summary":"Clean.","findings":[]}')), {
    summary: 'Clean.',
    findings: [],
  });
});

test('the fix follow-up carries each plan, the note and one final check', () => {
  const findings = reviewBlock(
    reply(
      JSON.stringify({
        findings: [
          {
            severity: 'high',
            title: 'Blank names save',
            file: 'src/profile.ts',
            line: 8,
            problem: 'Trim is skipped.',
            fix: 'Trim before validating.',
          },
        ],
      }),
    ),
  ).findings;
  const prompt = fixFollowUp(findings, { note: ' Keep the API. ', check: 'pnpm test' });
  assert.match(prompt, /1\. \[high\] Blank names save \(src\/profile\.ts:8\)/);
  assert.match(prompt, /Problem: Trim is skipped\./);
  assert.match(prompt, /Fix: Trim before validating\./);
  assert.match(prompt, /From me:\nKeep the API\./);
  assert.match(prompt, /run `pnpm test` once/);
  assert.doesNotMatch(fixFollowUp(findings, {}), /From me/);
  const many = Array.from({ length: 40 }, (_, index) => ({
    ...findings[0],
    key: String(index),
    problem: 'x'.repeat(900),
  }));
  const clipped = fixFollowUp(many, { check: 'pnpm test' }, 4_000);
  assert.ok(clipped.length <= 4_000);
  assert.match(clipped, /more findings were left out to fit/);
  assert.match(clipped, /pnpm test/);
});

test('a task’s agent reviews include reviews of any attempt, newest first', () => {
  const run = (id, extra) => ({ id, taskId: id, status: 'review', startedAt: id, ...extra });
  const runs = [
    run('1', { taskId: 'task' }),
    run('2', { taskId: 'task' }),
    run('3', { challengeOf: { runId: '1', kind: 'review' } }),
    run('4', { challengeOf: { runId: '2', kind: 'review' }, status: 'running' }),
    run('5', { challengeOf: { runId: '2' } }),
    run('6', { challengeOf: { runId: 'other', kind: 'review' } }),
  ];
  assert.deepEqual(
    taskReviews(runs, 'task').map((item) => item.id),
    ['4', '3'],
  );
  assert.equal(reviewState(runs[3]), 'running');
  assert.equal(reviewState(runs[2]), 'finished');
  assert.equal(reviewState({ ...runs[2], status: 'failed' }), 'failed');
});

test("a reviewer sees the author's recorded checks, decisions and screenshots", () => {
  assert.equal(authorEvidence({}), '');
  const text = authorEvidence({
    understanding: { goal: 'Pair the phone with the desktop' },
    validationSteps: [
      {
        step: 'Simulator pairs',
        status: 'passed',
        notes: 'Over loopback.',
        evidence: ['/tmp/a.png'],
      },
    ],
    decisions: [{ phase: 'scope', decision: 'Phone only', result: 'open' }],
    screenshots: [{ filePath: '/tmp/b.png' }],
  });
  assert.match(text, /do not report a claim as unbacked/);
  assert.match(text, /Goal: Pair the phone with the desktop/);
  assert.match(
    text,
    /- Check \(passed\): Simulator pairs\. Over loopback\. Evidence: \/tmp\/a\.png/,
  );
  assert.match(text, /- Decision \(scope\): Phone only\. Result: open/);
  assert.match(text, /- Screenshot: \/tmp\/b\.png/);
});
