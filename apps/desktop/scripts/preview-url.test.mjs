import assert from 'node:assert/strict';
import test from 'node:test';
import { previewUrl } from '../src/lib/preview-url.ts';

const origin = 'http://127.0.0.1:61234';

test('preview addresses preserve paths, query parameters, fragments and existing escapes', () => {
  for (const path of [
    '/',
    '/dashboard?tab=activity&sort=recent#details',
    '/files/a%2Fb?next=%2Fdashboard&text=hello%20world#item%23one',
    '/files/%252F?literal=%2525',
  ]) {
    assert.equal(previewUrl(61234, path), `${origin}${path}`);
  }
  assert.equal(
    previewUrl(61234, '/café notes?q=hello world#résumé'),
    `${origin}/caf%C3%A9%20notes?q=hello%20world#r%C3%A9sum%C3%A9`,
  );
});

test('preview URLs encode HTML payloads and stay on the managed loopback origin', () => {
  for (const path of [
    '/<svg onload=alert(1)>',
    '/?q="/><img src=x onerror=alert(1)>#<script>alert(1)</script>',
    '/javascript:alert(1)',
    '/%2f%2fexample.com',
    '/..//example.com',
  ]) {
    const value = previewUrl(61234, path);
    assert.ok(value, path);
    assert.equal(new URL(value).origin, origin);
    assert.doesNotMatch(value, /[<>"\s]/);
  }
});

test('preview URLs reject absolute addresses, authority overrides and malformed paths', () => {
  for (const path of [
    '',
    'dashboard',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://example.com/',
    '//example.com/',
    '///example.com/',
    '/\\example.com/',
    '/\t/example.com/',
    '/\n/example.com/',
    '/\r/example.com/',
    '/\0example.com/',
    '/\u007fexample.com/',
    '/\ud800',
    `/${'a'.repeat(2000)}`,
  ]) {
    assert.equal(previewUrl(61234, path), null, JSON.stringify(path));
  }
});

test('preview URLs require a valid allocated port', () => {
  for (const port of [0, -1, 80, 1023, 65536, 61234.5, NaN, Infinity, '61234', '61234@evil.test']) {
    assert.equal(previewUrl(port, '/'), null, String(port));
  }
  assert.equal(previewUrl(1024, '/'), 'http://127.0.0.1:1024/');
  assert.equal(previewUrl(65535, '/'), 'http://127.0.0.1:65535/');
});
