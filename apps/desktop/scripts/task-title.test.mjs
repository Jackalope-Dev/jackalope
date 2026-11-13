import assert from 'node:assert/strict';
import test from 'node:test';
import { taskTitle, withoutLeadingId } from '../src/lib/task-title.ts';

test('task titles keep the objective and omit conversational setup and explanations', () => {
  assert.equal(
    taskTitle('Can you please fix keyboard navigation in search? It skips results.'),
    'Fix keyboard navigation in search',
  );
  assert.equal(
    taskTitle(
      '### 🎯 Objective\n**Add a search shortcut**\n\nContext: preserve existing behavior.',
    ),
    'Add a search shortcut',
  );
  assert.equal(
    taskTitle(
      'Context\nCurrent project notes\nTask: Improve the review layout so that the diff is easier to find.',
    ),
    'Improve the review layout',
  );
  assert.equal(
    taskTitle('Please fix `index.ts` and [the search](https://example.invalid). Keep the API.'),
    'Fix index.ts and the search',
  );
});

test('legacy automatic titles are shortened without changing deliberate user titles or prompts', () => {
  const prompt =
    'Can you please clean up the task review page and show the outputs, checks, and next steps together?\nPreserve all existing actions.';
  assert.equal(
    taskTitle(prompt, prompt.split('\n')[0]),
    'Clean up the task review page and show the outputs',
  );
  assert.equal(taskTitle(prompt, 'Search usability'), 'Search usability');
  assert.equal(taskTitle(undefined, 'Saved title'), 'Saved title');
  assert.equal(taskTitle(''), 'Untitled task');
  assert(taskTitle('a'.repeat(300)).length <= 72);
});

test('task titles drop the task folder and shorten other absolute paths', () => {
  const roots = ['/Users/caden/Code/jackalope', '/Users/caden/Code/jackalope/.worktrees/fix'];
  const hook =
    '### 🎯 Objective\nThe pre-commit hook rejected a commit in /Users/caden/Code/jackalope (branch master).\nFix it.';
  assert.equal(taskTitle(hook), 'The pre-commit hook rejected a commit in ~/Code/jackalope');
  assert.equal(
    taskTitle(hook, undefined, roots),
    'The pre-commit hook rejected a commit (branch master)',
  );
  assert.equal(
    taskTitle(
      'Fix the lint error in /Users/caden/Code/jackalope/.worktrees/fix/src/app.ts.',
      undefined,
      roots,
    ),
    'Fix the lint error in src/app.ts',
  );
  assert.equal(
    taskTitle('Clean up /Users/caden/Code/jackalope/', undefined, roots),
    'Clean up jackalope',
  );
  assert.equal(
    taskTitle('Review C:\\Users\\sam\\repo\\README.md', undefined, ['C:\\Users\\sam\\repo']),
    'Review README.md',
  );
  assert.equal(taskTitle('Copy /home/sam/notes into /tmp/out'), 'Copy ~/notes into /tmp/out');
  assert.equal(
    taskTitle('Add a /review command and/or alias', undefined, roots),
    'Add a /review command and/or alias',
  );
  assert.equal(taskTitle('Fix /Users/caden/Code/jackalope', 'Saved title', roots), 'Saved title');
});

test('a leading run id drops from titles unless it is all there is', () => {
  const id = '02f4245e-f796-4353-a8e0-b8cc79871beb';
  assert.equal(
    taskTitle(`resume ${id} Always allow \`python3 -m http.server\` for this repo`),
    'Always allow python3 -m http.server for this repo',
  );
  assert.equal(taskTitle('a1b2c3d4e5f6a7b8 fix the login bug'), 'Fix the login bug');
  assert.equal(taskTitle(id), id);
  assert.equal(withoutLeadingId(`resume ${id}`), `resume ${id}`);
  assert.equal(withoutLeadingId(`resume ${id}: check the build`), 'Check the build');
  assert.equal(withoutLeadingId('Resume the failing build'), 'Resume the failing build');
  assert.equal(withoutLeadingId('Decaffeinated beans'), 'Decaffeinated beans');
});
