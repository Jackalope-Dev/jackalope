import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeDrift,
  featureMapForRegistry,
  featurePageError,
  newSuggestions,
  parseSources,
  withoutMissingPaths,
} from '../src/lib/feature-map.ts';
import { capturePageName } from '../src/lib/review-captures.ts';

test('feature pages must stay on the preview', () => {
  assert.equal(featurePageError('/settings?tab=billing'), '');
  assert.match(featurePageError(''), /Enter the page/);
  for (const page of [
    'settings',
    '//host/x',
    'https://example.com',
    '/a b',
    `/a${String.fromCharCode(92)}b`,
  ]) {
    assert.match(featurePageError(page), /single \//, page);
  }
});

test('the native mirror gets named entries with a usable page and no blank fields', () => {
  assert.equal(featureMapForRegistry(undefined), undefined);
  assert.equal(featureMapForRegistry([{ name: ' ', page: '/' }]), undefined);
  assert.deepEqual(
    featureMapForRegistry([
      { name: ' Billing ', page: ' /billing ', working: ' ', sources: [' src/billing/** ', ''] },
      { name: 'Off origin', page: 'billing' },
      { name: 'Home', page: '/', sources: [''] },
    ]),
    [
      {
        name: 'Billing',
        page: '/billing',
        steps: undefined,
        working: undefined,
        sources: ['src/billing/**'],
        routeFile: undefined,
      },
      {
        name: 'Home',
        page: '/',
        steps: undefined,
        working: undefined,
        sources: undefined,
        routeFile: undefined,
      },
    ],
  );
});

test('source paths are read one per line or comma separated', () => {
  assert.deepEqual(parseSources(' src/a/**\n\nsrc/b.ts, src/c/** '), [
    'src/a/**',
    'src/b.ts',
    'src/c/**',
  ]);
});

test('suggestions skip pages the map already covers', () => {
  const suggested = [
    { name: 'Home', page: '/' },
    { name: 'Settings', page: '/settings' },
    { name: 'Help', page: '/help' },
  ];
  assert.deepEqual(
    newSuggestions([{ name: 'Mine', page: '/settings/' }], suggested).map((entry) => entry.page),
    ['/', '/help'],
  );
});

test('fixing drift drops only the missing paths and keeps the entry', () => {
  const entry = {
    name: 'Billing',
    page: '/billing',
    working: 'Plan shown',
    sources: ['src/billing/**', 'src/old/**'],
    routeFile: 'app/billing/page.tsx',
  };
  const drift = {
    index: 0,
    missingRouteFile: 'app/billing/page.tsx',
    unmatchedSources: ['src/old/**'],
  };
  assert.deepEqual(withoutMissingPaths(entry, drift), {
    ...entry,
    sources: ['src/billing/**'],
    routeFile: undefined,
  });
  assert.equal(
    describeDrift(drift),
    'No longer matches any file: app/billing/page.tsx, src/old/**.',
  );
});

test('captures labeled by the map lead with the feature name', () => {
  assert.equal(capturePageName({ path: '/billing' }), '/billing');
  assert.equal(
    capturePageName({ path: '/billing', features: [{ name: 'Billing' }, { name: 'Invoices' }] }),
    'Billing, Invoices (/billing)',
  );
});
