import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseReleaseNotes, shouldShowReleaseNotes } from '../src/lib/release-notes.ts';

const notes = `# Jackalope 1.2.3

Status: ready
Date: 2026-09-27

## Highlights

- A big thing that wraps
  onto a second line.

## Fixes

- A fix.

## Known issues

- Something rough.
`;

test('ready notes keep the user-facing sections and join wrapped bullets', () => {
  assert.deepEqual(parseReleaseNotes('1.2.3', notes), {
    version: '1.2.3',
    sections: [
      { title: 'Highlights', items: ['A big thing that wraps onto a second line.'] },
      { title: 'Fixes', items: ['A fix.'] },
    ],
  });
});

test('drafts and placeholder notes are not shown', () => {
  assert.equal(parseReleaseNotes('1.2.3', notes.replace('ready', 'draft')), null);
  assert.equal(
    parseReleaseNotes('1.2.3', 'Status: ready\n\n## Highlights\n\n- TODO: describe it\n'),
    null,
  );
});

test('notes show after an update, never on a fresh install', () => {
  assert.equal(shouldShowReleaseNotes('1.2.3', '1.2.2', true), true);
  assert.equal(shouldShowReleaseNotes('1.2.3', '1.2.3', true), false);
  assert.equal(shouldShowReleaseNotes('1.2.3', null, true), true);
  assert.equal(shouldShowReleaseNotes('1.2.3', null, false), false);
});
