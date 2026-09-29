import assert from 'node:assert/strict';
import test from 'node:test';
import { searchFiles } from '../src/lib/file-search.ts';
import {
  appendAttachments,
  attachmentReference,
  draftAttachments,
  removeAttachment,
} from '../src/lib/prompt-attachments.ts';

test('attachment references stay relative inside the project and absolute elsewhere', () => {
  assert.equal(
    attachmentReference(String.raw`C:\repo\src\app.ts`, 'C:/repo'),
    'Attached file: src/app.ts',
  );
  assert.equal(
    attachmentReference('/home/me/repo/docs/shot.PNG', '/home/me/repo'),
    'Attached image: docs/shot.PNG',
  );
  assert.equal(
    attachmentReference(String.raw`C:/repo\.jackalope/attachments\a.png`, 'C:/repo'),
    String.raw`Attached image: C:\repo\.jackalope\attachments\a.png`,
  );
  assert.equal(
    attachmentReference('/tmp/spec.pdf', '/home/me/repo'),
    'Attached file: /tmp/spec.pdf',
  );
  assert.equal(attachmentReference('/repo-other/x.ts', '/repo'), 'Attached file: /repo-other/x.ts');
});

test('attachments append once, list and remove without disturbing the prompt', () => {
  const one = appendAttachments('Fix the header  \n', ['Attached image: a.png']);
  assert.equal(one, 'Fix the header\n\nAttached image: a.png');
  const two = appendAttachments(one, ['Attached image: a.png', 'Attached file: b.ts']);
  assert.equal(two, 'Fix the header\n\nAttached image: a.png\nAttached file: b.ts');
  assert.deepEqual(draftAttachments(two), ['Attached image: a.png', 'Attached file: b.ts']);
  assert.equal(
    removeAttachment(two, 'Attached image: a.png'),
    'Fix the header\n\nAttached file: b.ts',
  );
  assert.equal(appendAttachments('', ['Attached file: b.ts']), 'Attached file: b.ts');
});

test('file search prefers file-name matches and keeps subsequence matches', () => {
  const files = [
    'src/components/tasks/TaskDetail.tsx',
    'src/components/tasks/task-detail.css',
    'docs/TASKS.md',
    'src/lib/task-title.ts',
    'README.md',
  ];
  assert.equal(searchFiles(files, 'taskdetail')[0], 'src/components/tasks/TaskDetail.tsx');
  assert.equal(searchFiles(files, 'readme')[0], 'README.md');
  assert.equal(searchFiles(files, 'tsktitle')[0], 'src/lib/task-title.ts');
  assert.deepEqual(searchFiles(files, 'zzz'), []);
  assert.deepEqual(searchFiles(files, '  '), []);
  assert.equal(searchFiles(files, 'task', 2).length, 2);
});
