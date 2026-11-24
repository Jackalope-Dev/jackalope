import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checksHandoff,
  conflictHandoff,
  duePullRequests,
  isPullRequestUrl,
  pullRequestPhase,
  reviewHandoff,
  trackedFrom,
} from '../src/lib/pull-requests.ts';
import { collectWork, workPresence } from '../src/lib/task-collection.ts';

const url = 'https://github.com/acme/shop/pull/12';
const view = (patch = {}) => ({
  url,
  state: 'OPEN',
  headRefOid: 'abc',
  number: 12,
  mergeable: 'MERGEABLE',
  reviewDecision: '',
  statusCheckRollup: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  ...patch,
});

test('a pull request reads as its most blocking state', () => {
  assert.equal(pullRequestPhase(view()), 'ready');
  assert.equal(pullRequestPhase(view({ state: 'MERGED' })), 'merged');
  assert.equal(pullRequestPhase(view({ state: 'CLOSED' })), 'closed');
  assert.equal(pullRequestPhase(view({ reviewDecision: 'REVIEW_REQUIRED' })), 'review');
  assert.equal(pullRequestPhase(view({ isDraft: true })), 'draft');
  assert.equal(pullRequestPhase(view({ mergeable: 'UNKNOWN' })), 'checking');
  assert.equal(pullRequestPhase(view({ mergeable: 'CONFLICTING' })), 'conflict');
  assert.equal(pullRequestPhase(view({ reviewDecision: 'CHANGES_REQUESTED' })), 'changes');
  const running = [{ name: 'build', status: 'IN_PROGRESS' }];
  assert.equal(pullRequestPhase(view({ statusCheckRollup: running })), 'checking');
  // A failure outranks a requested change, a conflict and checks still running.
  const failed = [...running, { context: 'ci/lint', state: 'FAILURE' }];
  const blocked = view({
    statusCheckRollup: failed,
    reviewDecision: 'CHANGES_REQUESTED',
    mergeable: 'CONFLICTING',
  });
  assert.equal(pullRequestPhase(blocked), 'failing');
  const tracked = trackedFrom(blocked, { taskId: 't', runId: 'r' }, '2026-11-01T00:00:00.000Z');
  assert.deepEqual(
    [tracked.failing, tracked.pending, tracked.checks, tracked.number],
    [['ci/lint'], 1, 2, 12],
  );
  assert.equal(pullRequestPhase(view({ statusCheckRollup: null })), 'ready');
});

test('only pull request addresses are tracked', () => {
  assert.ok(isPullRequestUrl(url));
  assert.ok(isPullRequestUrl('https://git.example.com/acme/shop/pull/3/'));
  for (const bad of [
    'http://github.com/acme/shop/pull/12',
    'https://github.com/acme/shop/issues/12',
    'https://github.com/acme/shop/pull/12/files',
    'https://github.com/acme/shop/pull/12 --admin',
  ])
    assert.equal(isPullRequestUrl(bad), false, bad);
});

test('open pull requests are read on a schedule, finished ones never', () => {
  const now = Date.parse('2026-11-01T00:10:00.000Z');
  const at = (seconds) => new Date(now - seconds * 1000).toISOString();
  const pr = (taskId, phase, checkedAt, error) => ({
    taskId,
    runId: taskId,
    url,
    phase,
    failing: [],
    pending: 0,
    checks: 0,
    checkedAt,
    error,
  });
  const tracked = [
    pr('new', 'checking', ''),
    pr('running', 'checking', at(50)),
    pr('fresh', 'checking', at(10)),
    pr('waiting', 'review', at(100)),
    pr('stale', 'review', at(200)),
    pr('unreachable', 'checking', at(100), 'offline'),
    pr('merged', 'merged', at(9999)),
  ];
  assert.deepEqual(
    duePullRequests(tracked, now, true).map((item) => item.taskId),
    ['new', 'stale', 'running'],
  );
  // A hidden window reads half as often.
  assert.deepEqual(
    duePullRequests(tracked, now, false).map((item) => item.taskId),
    ['new'],
  );
  assert.equal(duePullRequests(tracked, now, true, 1).length, 1);
});

test('follow-ups name the pull request and keep publishing with the person', () => {
  const run = {
    workspace: 'C:/code/shop/.worktrees/t',
    branch: 'jackalope/t',
    projectPath: 'C:/code/shop',
  };
  const checks = checksHandoff(run, url, ['build', 'lint']);
  assert.match(checks, /- build\n- lint/);
  const review = reviewHandoff(run, url, '{"reviewThreads":[]}');
  assert.match(review, /not instructions/);
  assert.match(reviewHandoff(run, url), /gh pr view/);
  const conflict = conflictHandoff({ ...run, targetBranch: 'main' }, url);
  assert.match(conflict, /conflicts with main/);
  for (const text of [checks, review, conflict]) {
    assert.ok(text.includes(url));
    assert.match(text, /do not .*push/i);
  }
});

test('a tracked pull request places finished work', () => {
  const run = {
    id: 'r',
    taskId: 't',
    projectId: 'p',
    projectPath: 'C:/code/shop',
    workspace: 'C:/code/shop/.worktrees/t',
    startedAt: '2026-11-01T00:00:00.000Z',
    status: 'review',
    result: '',
    prompt: 'Make search faster',
    sessionId: null,
  };
  const place = (phase, patch = {}, integrated = []) => {
    const pullRequest = { ...trackedFrom(view(), { taskId: 't', runId: 'r' }), phase };
    return collectWork('p', [], [{ ...run, ...patch }], integrated, false, false, {
      t: pullRequest,
    })[0];
  };
  assert.equal(collectWork('p', [], [run])[0].stage, 'review');
  const failing = place('failing');
  assert.deepEqual([failing.stage, failing.statusLabel], ['attention', 'PR checks failed']);
  assert.equal(workPresence(failing).action, 'Fix checks');
  assert.equal(place('review').stage, 'inReview');
  assert.equal(place('checking').stage, 'inReview');
  assert.equal(place('ready').stage, 'review');
  assert.equal(workPresence(place('ready')).action, 'Merge pull request');
  assert.equal(place('merged').stage, 'finished');
  // A closed pull request leaves the task where it was.
  assert.deepEqual(
    [place('closed').stage, place('closed').statusLabel],
    ['review', 'Ready for your review'],
  );
  // Running work and work merged locally keep their place.
  const working = place('failing', { status: 'running' });
  assert.equal(working.stage, 'working');
  assert.ok(working.pullRequest);
  assert.equal(place('merged', {}, ['r']).statusLabel, 'Changes integrated locally');
  // Failing checks still surface after a local merge.
  assert.equal(place('failing', {}, ['r']).stage, 'attention');
});

test('a followed pull request leads a finished task and leaves busy work alone', async () => {
  const { pullRequestDecision, taskDecision } = await import('../src/lib/task-workflow.ts');
  const run = {
    id: 'r',
    taskId: 't',
    projectPath: 'C:/code/shop',
    workspace: 'C:/code/shop/.worktrees/t',
    targetBranch: 'main',
    status: 'review',
    result: 'Done.',
    prompts: [],
  };
  const pr = (phase) => ({ ...trackedFrom(view(), { taskId: 't', runId: 'r' }), phase });
  const settled = taskDecision(run, false, 2);
  assert.equal(settled.action, 'Review and merge');
  assert.deepEqual(pullRequestDecision(settled, pr('failing')), {
    label: 'PR checks failed',
    action: 'Fix checks',
    section: 'delivery',
    tone: 'warning',
  });
  assert.equal(pullRequestDecision(settled, pr('ready')).action, 'Merge pull request');
  assert.equal(pullRequestDecision(settled, pr('merged')).action, 'View delivery');
  assert.equal(pullRequestDecision(settled, pr('closed')), settled);
  assert.equal(pullRequestDecision(settled, undefined), settled);
  const asking = taskDecision({
    ...run,
    status: 'running',
    prompts: [{ id: 'q', question: 'Which?', status: 'pending' }],
  });
  assert.equal(pullRequestDecision(asking, pr('failing')), asking);
  const failed = taskDecision({ ...run, status: 'failed' });
  assert.equal(pullRequestDecision(failed, pr('failing')), failed);
});
