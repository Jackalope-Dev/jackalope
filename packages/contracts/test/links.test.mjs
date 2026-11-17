import assert from 'node:assert/strict';
import test from 'node:test';
import { isAccessToken, websiteLink } from '../src/links.ts';
import { microsoftStoreUrl } from '../src/release.ts';

test('website links carry tokens in the fragment and invitations in the query', () => {
  const token = 'a'.repeat(64);
  const origin = 'https://jackalope.dev';
  assert.equal(
    websiteLink(origin, 'download', { fragment: { token } }),
    `${origin}/download/#token=${token}`,
  );
  assert.equal(
    websiteLink(origin, 'access', { fragment: 'invitations' }),
    `${origin}/access/#invitations`,
  );
  assert.equal(
    websiteLink(origin, 'access', { query: { invite: token } }),
    `${origin}/access/?invite=${token}`,
  );
  assert.equal(websiteLink(origin, 'home', { query: { ref: token } }), `${origin}/?ref=${token}`);
  assert.ok(isAccessToken(token));
  assert.ok(
    !isAccessToken(`${token}0`) && !isAccessToken(token.toUpperCase()) && !isAccessToken(null),
  );
});

test('Store links must be Microsoft product pages', () => {
  for (const url of [
    'https://apps.microsoft.com/detail/9NM89QFJQ244',
    'https://apps.microsoft.com/detail/9NM89QFJQ244/',
    'https://apps.microsoft.com/detail/9NM89QFJQ244?hl=en-us&gl=US',
    'https://www.microsoft.com/store/apps/9NM89QFJQ244',
  ])
    assert.equal(microsoftStoreUrl(url), url);
  for (const url of [
    undefined,
    'http://apps.microsoft.com/detail/9NM89QFJQ244',
    'https://apps.microsoft.com/detail/9NM89QFJQ244#reviews',
    'https://apps.microsoft.com:444/detail/9NM89QFJQ244',
    'https://apps.microsoft.com.evil.test/detail/9NM89QFJQ244',
    'https://www.microsoft.com/detail/9NM89QFJQ244',
  ])
    assert.equal(microsoftStoreUrl(url), null, url);
});
