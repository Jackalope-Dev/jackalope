import assert from 'node:assert/strict';
import test from 'node:test';
import { documentationIssues } from './docs-policy.mjs';

const docs = (filename, source) =>
  new Map([
    ['docs/README.md', `[Guide](${filename.slice(5)})`],
    [filename, source],
  ]);

test('maintained guidance permits compatibility versions, fixtures and reusable templates', () => {
  const documents = docs(
    'docs/STORAGE.md',
    '# Storage\nMigration 0015 preserves existing records.\n## Verification\nRun the isolated native tests.\n```text\n## Local validation — September 10, 2026\n```',
  );
  documents.set('releases/0.1.0.md', '# Release\nDate: 2026-09-10');
  documents.set('releases/2026-09-10.md', '# Release notes');
  assert.deepEqual(documentationIssues(documents), []);
  assert.deepEqual(
    documentationIssues(
      docs(
        'docs/releases/RELEASE-RECORD-TEMPLATE.md',
        '# Release record template\n- Date / operator:',
      ),
    ),
    [],
  );
});

test('adding a doc requires index registration even when links otherwise resolve', () => {
  const documents = docs('docs/STORAGE.md', '# Storage');
  documents.set('docs/NEW-FEATURE.md', '# Feature behavior');
  assert.equal(documentationIssues(documents).length, 1);
  documents.set('docs/README.md', '[Storage](STORAGE.md)\n[Feature](NEW-FEATURE.md#behavior)');
  assert.deepEqual(documentationIssues(documents), []);
});

test('indexing an internal record does not permit its path or dated narrative', () => {
  for (const filename of [
    'docs/2026-09-10-results.md',
    'docs/plans/FEATURE.md',
    'docs/FEATURE-AUDIT.md',
  ])
    assert.ok(documentationIssues(docs(filename, '# Results')).length > 0);
  for (const source of [
    '# Feature\n## Local validation — September 10, 2026',
    '# Feature\n## Integration decisions and next experiments',
    '# Feature\nSee C:\\Users\\example\\Desktop\\results.',
  ])
    assert.ok(documentationIssues(docs('docs/FEATURE.md', source)).length > 0);
});
