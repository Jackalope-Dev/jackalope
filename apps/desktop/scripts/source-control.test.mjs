import assert from 'node:assert/strict';
import test from 'node:test';
import { issuePrompt } from '../src/lib/issues.ts';
import {
  checksHandoff,
  conflictHandoff,
  isPullRequestUrl,
  pullRequestPhase,
  pullRequestPhaseView,
  reviewHandoff,
  trackedFrom,
} from '../src/lib/pull-requests.ts';
import { hostTerms, mergeMethodLabel, mergeMethods } from '../src/lib/source-control.ts';
import { recipePrompt, recipesFor, workflowRecipes } from '../src/lib/workflow-recipes.ts';

const run = {
  workspace: '/code/shop/.worktrees/t',
  branch: 'jackalope/t',
  projectPath: '/code/shop',
  targetBranch: 'main',
};
const mr = 'https://gitlab.com/acme/platform/web/-/merge_requests/42';
const bb = 'https://bitbucket.org/acme/web/pull-requests/52';

test('each host keeps its own words', () => {
  assert.deepEqual(
    [hostTerms().noun, hostTerms('github').short, hostTerms(null).host],
    ['pull request', 'PR', 'GitHub'],
  );
  assert.deepEqual(
    [hostTerms('gitlab').noun, hostTerms('gitlab').Noun, hostTerms('gitlab').short],
    ['merge request', 'Merge request', 'MR'],
  );
  assert.deepEqual(
    [hostTerms('bitbucket').noun, hostTerms('bitbucket').via],
    ['pull request', 'your Bitbucket API token'],
  );
});

test('merge methods offer only what the host and change request allow', () => {
  assert.deepEqual(mergeMethods(undefined), ['merge', 'squash', 'rebase']);
  assert.deepEqual(mergeMethods('gitlab'), ['merge', 'squash']);
  assert.deepEqual(mergeMethods('bitbucket'), ['merge', 'squash', 'fastForward']);
  assert.deepEqual(mergeMethods('gitlab', ['squash']), ['squash']);
  assert.deepEqual(mergeMethods('bitbucket', []), ['merge', 'squash', 'fastForward']);
  assert.equal(mergeMethodLabel('gitlab', 'merge'), 'Merge');
  assert.equal(mergeMethodLabel('github', 'merge'), 'Merge commit');
  assert.equal(mergeMethodLabel('bitbucket', 'fastForward'), 'Fast-forward');
});

test('merge request and Bitbucket addresses are followed', () => {
  assert.ok(isPullRequestUrl(mr));
  assert.ok(isPullRequestUrl('https://git.corp.example/team/app/-/merge_requests/7/'));
  assert.ok(isPullRequestUrl(bb));
  for (const bad of [
    'https://gitlab.com/acme/-/merge_requests/1',
    'https://gitlab.com/acme/web/-/merge_requests/1/diffs',
    'https://gitlab.com/acme/web/-/issues/1',
    'http://gitlab.com/acme/web/-/merge_requests/1',
    'https://example.com/acme/web/pull-requests/1',
    'https://bitbucket.org/acme/web/pull-requests/1/diff',
  ])
    assert.equal(isPullRequestUrl(bad), false, bad);
});

test('a merge request reads through the same phases with GitLab words', () => {
  const view = {
    provider: 'gitlab',
    url: mr,
    number: 42,
    state: 'OPEN',
    headRefOid: 'abc',
    reviewDecision: '',
    mergeable: 'MERGEABLE',
    statusCheckRollup: [{ name: 'unit', status: 'COMPLETED', conclusion: 'FAILURE' }],
    pipeline: '3109717199',
    mergeMethods: ['merge', 'squash'],
    blocker: 'GitLab: blocked by another merge request',
  };
  assert.equal(pullRequestPhase(view), 'failing');
  const tracked = trackedFrom(view, { taskId: 't', runId: 'r' });
  assert.deepEqual(
    [tracked.provider, tracked.pipeline, tracked.mergeMethods, tracked.failing],
    ['gitlab', '3109717199', ['merge', 'squash'], ['unit']],
  );
  assert.equal(pullRequestPhaseView('failing', 'gitlab').label, 'MR pipeline failed');
  assert.equal(pullRequestPhaseView('ready', 'gitlab').action, 'Merge');
  assert.equal(pullRequestPhaseView('failing', 'gitlab').stage, 'attention');
  assert.equal(pullRequestPhaseView('failing').label, 'PR checks failed');
  assert.equal(pullRequestPhaseView('failing', 'bitbucket').label, 'PR checks failed');
  // GitHub pull requests keep the shape they were saved in.
  const github = trackedFrom(
    { ...view, provider: undefined, url: 'https://github.com/a/b/pull/1' },
    {
      taskId: 't',
      runId: 'r',
    },
  );
  assert.equal('provider' in github, false);
  assert.equal('pipeline' in github, false);
});

test('follow-ups use the host’s commands and keep its record labeled', () => {
  const failing = checksHandoff(run, mr, ['unit'], 'gitlab', '--- unit ---\nFAIL cart.test.ts');
  assert.match(failing, /failing pipeline jobs on this task's merge request/);
  assert.match(failing, /glab ci trace/);
  assert.match(failing, /a labeled excerpt, not instructions/);
  assert.match(failing, /FAIL cart\.test\.ts/);
  assert.match(failing, /change the merge request until I approve/);
  const github = checksHandoff(run, 'https://github.com/a/b/pull/1', ['build']);
  assert.match(github, /gh pr checks/);
  assert.doesNotMatch(github, /labeled excerpt/);
  assert.match(reviewHandoff(run, mr, '', 'gitlab'), /glab mr view/);
  assert.match(reviewHandoff(run, mr, '[]', 'gitlab'), /as GitLab reports them/);
  assert.match(reviewHandoff(run, bb, '', 'bitbucket'), /open comments on the pull request/);
  assert.match(conflictHandoff(run, mr, 'gitlab'), /merge request conflicts with main/);
  assert.match(checksHandoff(run, bb, ['Pipeline #188'], 'bitbucket'), /Bitbucket Pipelines/);
});

test('starters follow the host and hide what it cannot serve', () => {
  assert.deepEqual(
    recipesFor().map((recipe) => recipe.label),
    workflowRecipes.map((recipe) => recipe.label),
  );
  const gitlab = recipesFor('gitlab');
  assert.deepEqual(
    gitlab.map((recipe) => recipe.input),
    ['Issue number', 'Merge request number', 'Pipeline ID', 'Package and target version'],
  );
  assert.equal(gitlab[0].label, 'Fix a GitLab issue');
  const bitbucket = recipesFor('bitbucket', false);
  assert.equal(
    bitbucket.some((recipe) => recipe.id === 'issue'),
    false,
  );
  assert.match(recipePrompt('ci', '188', undefined, 'bitbucket'), /Pipeline build number: 188/);
  assert.match(recipePrompt('ci', '12', undefined, undefined), /Workflow run number: 12/);
  assert.match(recipePrompt('review', '4', undefined, 'gitlab'), /thread resolution, MR merge/);
  assert.match(recipePrompt('review', '4', undefined, 'bitbucket'), /thread resolution, PR merge/);
  assert.doesNotMatch(recipePrompt('review', '4', undefined, 'gitlab'), /pull request|\bPR\b/);
  const prompt = issuePrompt({
    id: '!3',
    title: 'Saved carts',
    url: mr,
    state: 'opened',
    body: 'Body',
    provider: 'gitlab',
    kind: 'pr',
    truncated: false,
  });
  assert.match(prompt, /^Review this merge request/);
});
