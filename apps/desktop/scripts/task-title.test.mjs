import assert from 'node:assert/strict';
import test from 'node:test';
import { taskTitle } from '../src/lib/task-title.ts';

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
