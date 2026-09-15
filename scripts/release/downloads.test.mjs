import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detectDesktopPlatform,
  platformDownloads,
} from '../../apps/website/src/platform-downloads.ts';

test('desktop platform detection handles browser hints and avoids mobile and ChromeOS lookalikes', () => {
  for (const [browser, expected] of [
    [{ platform: 'Windows' }, 'windows'],
    [{ platform: 'Win32', maxTouchPoints: 10 }, 'windows'],
    [{ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, 'windows'],
    [{ platform: 'macOS' }, 'macos'],
    [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }, 'macos'],
    [{ platform: 'Linux x86_64' }, 'linux'],
    [{ platform: 'MacIntel', maxTouchPoints: 5 }, null],
    [{ platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 15)' }, null],
    [{ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18 like Mac OS X)' }, null],
    [{ platform: 'Linux', userAgent: 'Mozilla/5.0 (X11; CrOS x86_64)' }, null],
    [{}, null],
  ])
    assert.equal(detectDesktopPlatform(browser), expected, JSON.stringify(browser));
});

test('unpublished platforms have no download action; each configured release enables only its platform', () => {
  assert.deepEqual(
    platformDownloads({}).map((entry) => entry.url),
    [null, null, null],
  );
  const downloads = platformDownloads({
    VITE_MACOS_DOWNLOAD_URL: 'https://downloads.example.test/Jackalope.dmg',
    VITE_RELEASE_VERSION: '0.1.0',
  });
  assert.equal(downloads[0].url, null);
  assert.equal(downloads[1].url, 'https://downloads.example.test/Jackalope.dmg');
  assert.equal(downloads[2].url, null);
  assert.throws(
    () => platformDownloads({ VITE_LINUX_DOWNLOAD_URL: 'https://example.test/app' }),
    /VITE_RELEASE_VERSION/,
  );
});

test('a configured Store product takes precedence and rejects foreign or credential-bearing destinations', () => {
  const store = 'https://apps.microsoft.com/detail/9NM89QFJQ244';
  const [windows] = platformDownloads({
    VITE_WINDOWS_STORE_URL: store,
    VITE_WINDOWS_DOWNLOAD_URL: 'https://example.test/old.exe',
  });
  assert.equal(windows.url, store);
  assert.equal(windows.store, true);
  for (const url of [
    'http://example.test/app',
    'javascript:alert(1)',
    'https://user:secret@example.test/app',
  ]) {
    assert.throws(() =>
      platformDownloads({ VITE_WINDOWS_DOWNLOAD_URL: url, VITE_RELEASE_VERSION: '0.1.0' }),
    );
  }
  for (const url of [
    'https://apps.microsoft.com.evil.test/detail/9NM89QFJQ244',
    `${store}?redirect=other`,
    `${store}#fragment`,
    'https://apps.microsoft.com/search',
  ]) {
    assert.throws(() => platformDownloads({ VITE_WINDOWS_STORE_URL: url }), /Microsoft Store/);
  }
});
