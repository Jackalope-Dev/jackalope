import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorFollowUp,
  findingsBlock,
  mergeFindings,
  reviewerReport,
} from '../src/lib/challenge-review.ts';
import { authorOf, modelFamily, rankReviewers } from '../src/lib/reviewer-choice.ts';

const step = (title, status, finding) => ({
  id: title,
  step: title,
  status,
  evidence: [],
  timestamp: 'now',
  finding,
});
const blankName = {
  command: 'node repro.mjs',
  output: 'saved profile ""',
  expected: 'Error: name is required',
  breaks: 'The request says blank names are rejected.',
};

test('only findings with a command and its output are proven; the rest are dropped', () => {
  const report = reviewerReport({
    validationSteps: [
      step('Blank name saves', 'failed', blankName),
      step('Might leak memory', 'failed', { command: '', output: '', expected: '', breaks: '' }),
      step('Unicode names', 'failed', { ...blankName, command: 'node uni.mjs', output: '' }),
      step('Ordinary checkpoint', 'passed'),
    ],
  });
  assert.deepEqual(
    report.proven.map((item) => item.title),
    ['Blank name saves'],
  );
  assert.equal(report.dropped, 2);
  assert.equal(report.structured, true);
});

test('the reply block is a fallback that does not repeat recorded findings', () => {
  const reply = `Summary.\n\`\`\`jackalope-findings\n${JSON.stringify([
    { title: 'Blank name is saved', ...blankName },
    {
      title: 'Whitespace name saves',
      command: 'node space.mjs',
      output: 'saved',
      expected: 'error',
      breaks: 'x',
    },
  ])}\n\`\`\``;
  const report = reviewerReport(
    { validationSteps: [step('Blank name saves', 'failed', blankName)] },
    reply,
  );
  assert.deepEqual(
    report.proven.map((item) => item.command),
    ['node repro.mjs', 'node space.mjs'],
  );
  const toolless = reviewerReport({ validationSteps: [] }, reply);
  assert.equal(toolless.proven.length, 2);
  assert.equal(toolless.structured, true);
});

test('an empty block means no findings, and prose alone is unreadable', () => {
  const none = reviewerReport({}, 'Nothing broke.\n```jackalope-findings\n[]\n```');
  assert.deepEqual(none, { proven: [], dropped: 0, structured: true });
  const prose = reviewerReport({}, 'I think the name check is wrong.');
  assert.equal(prose.structured, false);
  assert.equal(findingsBlock('```jackalope-findings\nnot json\n```'), undefined);
});

test('reviewers that prove the same root cause are merged and both credited', () => {
  const merged = mergeFindings([
    {
      run: { id: 'a', agent: 'codex', workspace: '/a' },
      report: reviewerReport({ validationSteps: [step('Blank name saves', 'failed', blankName)] }),
    },
    {
      run: { id: 'b', agent: 'claude', workspace: '/b' },
      report: reviewerReport({
        validationSteps: [
          step('Blank name saves', 'failed', { ...blankName, command: 'pnpm test profile' }),
          step('Deleting the last profile crashes', 'failed', {
            command: 'pnpm test delete',
            output: 'TypeError: cannot read id',
            expected: 'pass',
            breaks: 'Deleting must keep working.',
          }),
        ],
      }),
    },
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged[0].sources.map((source) => source.agent),
    ['codex', 'claude'],
  );
  assert.deepEqual(
    merged[1].sources.map((source) => source.agent),
    ['claude'],
  );
});

test('the follow-up carries each selected command, output, expectation and reviewer', () => {
  const [finding] = mergeFindings([
    {
      run: { id: 'a', agent: 'codex', workspace: 'C:/review' },
      report: reviewerReport({ validationSteps: [step('Blank name saves', 'failed', blankName)] }),
    },
  ]);
  const text = authorFollowUp([finding], (agent) => (agent === 'codex' ? 'Codex' : agent));
  for (const expected of [
    'Blank name saves (found by Codex)',
    'Reviewer workspace: C:/review',
    'Command: node repro.mjs',
    'saved profile ""',
    'The intent requires: Error: name is required',
    'Why this breaks the intent: The request says blank names are rejected.',
  ])
    assert.ok(text.includes(expected), expected);
  const many = Array.from({ length: 20 }, (_, index) => ({
    ...finding,
    title: `Finding ${index}`,
    output: 'x'.repeat(1_200),
  }));
  const bounded = authorFollowUp(many, String);
  assert.ok(bounded.length <= 10_100);
  assert.match(bounded, /more findings were left out to fit/);
});

test('default reviewers prefer another model family, then unknown, then the same family', () => {
  assert.equal(modelFamily('claude'), 'anthropic');
  assert.equal(modelFamily('opencode'), null);
  assert.equal(modelFamily('opencode', 'openai/gpt-5'), 'openai');
  assert.equal(modelFamily('antigravity', 'claude-sonnet-4'), 'anthropic');
  const runners = [
    { id: 'claude', name: 'Claude Code', available: true },
    { id: 'antigravity', name: 'Antigravity', available: true },
    { id: 'opencode', name: 'OpenCode', available: true },
    { id: 'codex', name: 'Codex', available: false },
    { id: 'gemini', name: 'Gemini CLI', available: true },
  ];
  const ranked = rankReviewers(runners, { agent: 'antigravity', model: 'gemini-3-pro' });
  assert.deepEqual(
    ranked.map((runner) => runner.id),
    ['claude', 'opencode', 'gemini', 'antigravity'],
  );
  assert.deepEqual(
    rankReviewers(runners, { agent: 'claude', model: null }).map((runner) => runner.id),
    ['antigravity', 'gemini', 'opencode', 'claude'],
  );
  assert.deepEqual(
    authorOf({
      agent: 'auto',
      model: null,
      routing: { decisions: [{ agent: 'codex', model: 'gpt-5' }] },
    }),
    { agent: 'codex', model: 'gpt-5' },
  );
});
