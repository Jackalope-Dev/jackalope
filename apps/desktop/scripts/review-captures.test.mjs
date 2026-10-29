import assert from 'node:assert/strict';
import test from 'node:test';
import {
  capturedPages,
  reviewCapturesOn,
  reviewPagesForRegistry,
} from '../src/lib/review-captures.ts';

test('review screenshots need a preview command and stay on unless turned off', () => {
  assert.equal(reviewCapturesOn(undefined), false);
  assert.equal(reviewCapturesOn({ previewCommand: '  ' }), false);
  assert.equal(reviewCapturesOn({ previewCommand: 'pnpm dev --port {port}' }), true);
  assert.equal(
    reviewCapturesOn({ previewCommand: 'pnpm dev --port {port}', reviewCaptures: false }),
    false,
  );
});

test('review pages reach the native mirror trimmed and without blank lines', () => {
  assert.equal(reviewPagesForRegistry(undefined), undefined);
  assert.equal(reviewPagesForRegistry(['', '  ']), undefined);
  assert.deepEqual(reviewPagesForRegistry([' /settings ', '', '/']), ['/settings', '/']);
});

test('only pages with an image are offered for comparison', () => {
  const shot = { id: 'a', name: 'a', url: '', filePath: '', width: 1, height: 1, timestamp: '' };
  const page = {
    path: '/',
    viewport: 'desktop',
    width: 1280,
    height: 800,
    reasons: [],
    criteria: [],
  };
  const pages = capturedPages({
    capturedAt: '',
    beforeAvailable: false,
    notes: [],
    pages: [page, { ...page, path: '/a', after: shot }, { ...page, path: '/b', before: shot }],
  });
  assert.deepEqual(
    pages.map((item) => item.path),
    ['/a', '/b'],
  );
  assert.deepEqual(capturedPages(null), []);
});
