import assert from 'node:assert/strict';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const html = 'apps/desktop/.waitlist-fixture.html';
const entry = 'apps/desktop/.waitlist-fixture.tsx';
if (existsSync(html) || existsSync(entry))
  throw Error('A fixture already exists; inspect it before retrying.');
mkdirSync('output/waitlist-referrals', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  writeFileSync(
    html,
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root"></main><script type="module" src="/.waitlist-fixture.tsx"></script></body></html>',
  );
  writeFileSync(
    entry,
    `import React from 'react';
import {createRoot} from 'react-dom/client';
import {ReferralSettings} from './src/components/settings/ReferralSettings';
import {useThemeStore} from './src/stores/themeStore';
import './src/index.css';
import './src/components/settings/settings.css';
const sample={limit:5,remaining:3,accepted:1,downloaded:1,connected:0,shareUrl:'https://jackalope.dev/access/?invite=${'c'.repeat(64)}',invites:[]};
window.__TAURI_INTERNALS__={invoke:async()=>sample};
window.fixtureTheme=useThemeStore;
document.body.style.cssText='background:var(--color-bg);color:var(--color-text-primary);padding:32px';
createRoot(document.getElementById('root')).render(<div style={{maxWidth:780,margin:'auto'}}><h1 style={{fontSize:28,marginBottom:24}}>Instant Access Passes</h1><ReferralSettings onAccount={()=>{}}/></div>);`,
  );
  for (const viewport of [
    { width: 1280, height: 840 },
    { width: 960, height: 640 },
  ]) {
    const context = await browser.newContext({
      viewport,
      reducedMotion: 'reduce',
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:5199/.waitlist-fixture.html');
    await page.getByText('Pass 5', { exact: true }).waitFor();
    for (const dark of [false, true]) {
      await page.evaluate((dark) => {
        const store = window.fixtureTheme;
        store
          .getState()
          .setTheme({ ...store.getState().currentTheme, isDark: dark, appearance: 'manual' });
      }, dark);
      assert.equal(await page.locator('.desktop-pass-strip li').count(), 5);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({
        path: `output/waitlist-referrals/desktop-passes-${viewport.width}-${dark ? 'dark' : 'light'}.png`,
        fullPage: true,
      });
    }
    const before = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-bg'),
    );
    await page.reload();
    await page.getByText('Pass 5', { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--color-bg'),
      ),
      before,
    );
    const copy = page.getByRole('button', { name: 'Copy link', exact: true });
    await copy.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('status').filter({ hasText: 'Pass link copied.' }).waitFor();
    assert.notEqual(await copy.evaluate((el) => getComputedStyle(el).outlineStyle), 'none');
    assert(
      (await page.evaluate(() => navigator.clipboard.readText())).includes('/access/?invite='),
    );
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    'Desktop pass fixtures passed at 1280×840 and 960×640, both themes, persistence, keyboard copy, reduced motion, and overflow. No native execution was tested.',
  );
} finally {
  await browser.close();
  if (existsSync(html)) unlinkSync(html);
  if (existsSync(entry)) unlinkSync(entry);
}
