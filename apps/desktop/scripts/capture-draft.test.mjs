import assert from 'node:assert/strict';
import test from 'node:test';
import { captureDraftForProject } from '../src/lib/capture-draft.ts';

const project = { id: 'new', preferences: { isolatedByDefault: false } };
const draft = {
  prompt: 'Keep my task text',
  agent: 'codex',
  isolated: true,
  projectId: '',
  model: 'old-model',
  connectionIds: ['old-tool'],
  contextSelection: { files: ['old-file'] },
};

test('entering a project replaces Choose later while retaining task intent', () => {
  const drafts = { capture: draft, 'planning:idea': draft, old: draft };
  const next = captureDraftForProject(drafts, project, 'old');
  assert.equal(next.projectId, 'new');
  assert.equal(next.prompt, draft.prompt);
  assert.equal(next.agent, draft.agent);
  assert.equal(next.isolated, true);
  assert.equal(next.model, undefined);
  assert.equal(next.connectionIds, undefined);
  assert.equal(next.contextSelection, undefined);
  assert.deepEqual(drafts, { capture: draft, 'planning:idea': draft, old: draft });
});

test('fresh capture inherits the entered project and its workspace preference', () => {
  assert.deepEqual(captureDraftForProject({}, project, null), {
    projectId: 'new',
    isolated: false,
    model: undefined,
    connectionIds: undefined,
    contextSelection: undefined,
  });
});

test('legacy draft text is carried forward and only changed-project context is cleared', () => {
  const legacy = { ...draft, projectId: undefined };
  const next = captureDraftForProject({ old: legacy }, project, 'old');
  assert.equal(next.prompt, legacy.prompt);
  assert.equal(next.projectId, 'new');
  assert.equal(next.contextSelection, undefined);
  const sameProject = { ...draft, projectId: 'new' };
  assert.deepEqual(captureDraftForProject({ capture: sameProject }, project, 'new'), sameProject);
});
