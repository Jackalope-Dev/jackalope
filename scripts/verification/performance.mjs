import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

let url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5197';
const production = process.argv.includes('--production');
const output = production
  ? 'output/playwright/performance-production'
  : 'output/playwright/performance';
await mkdir(output, { recursive: true });
const fixture = `
import React from 'react';
import ReactDOM from 'react-dom/client';
import { TaskCollection } from '/src/components/tasks/TaskCollection.tsx';
import TaskMarkdown from '/src/components/tasks/TaskMarkdown.tsx';
import RichDiff from '/src/components/tasks/RichDiff.tsx';
import { applyThemeTokens, DEFAULT_THEME } from '/node_modules/@jackalope/brand/src/theme.ts';
import '/src/index.css';
import '/src/components/tasks/task-workspace.css';
import '/src/components/ui/experience.css';
const items = Array.from({ length: 1000 }, (_, index) => ({
  id: 'idea-' + index, title: 'Example task ' + index, stage: 'ideas', date: '2026-01-01T12:00:00Z',
  idea: { id: 'idea-' + index, title: 'Example task ' + index, rawPrompt: 'Searchable history ' + index, status: 'backlog' },
}));
const patch = 'diff --git a/large.ts b/large.ts\\nnew file mode 100644\\n--- /dev/null\\n+++ b/large.ts\\n@@ -0,0 +1,10000 @@\\n' + Array.from({ length: 10000 }, (_, i) => '+export const value' + i + ' = ' + i + ';').join('\\n') + '\\n';
const code = '// ' + 'a'.repeat(110) + '\\nconst value = 1;\\n// ' + 'z'.repeat(110);
const markdown = (text, language) => '# Result\\n\\n[Open link](https://example.com)\\n\\n<script data-injected>bad()</script>\\n\\n' + String.fromCharCode(96).repeat(3) + language + '\\n' + text + '\\n' + String.fromCharCode(96).repeat(3);
window.performanceFixture = { code, patch, theme: appearance => applyThemeTokens({ ...DEFAULT_THEME, isDark: appearance === 'dark' }), opened: null, longTasks: [] };
const f = window.performanceFixture;
new PerformanceObserver(list => f.longTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask', buffered: true });
f.theme('dark');
function Fixture() {
  const [mode, setMode] = React.useState('list');
  const [text, setText] = React.useState(code);
  const [language, setLanguage] = React.useState('typescript');
  const [view, setView] = React.useState({ filter: 'all', layout: 'list', query: '' });
  f.mode = setMode; f.text = setText; f.language = setLanguage;
  return React.createElement('main', { className: 'p-8', style: { maxWidth: '100%', overflow: 'auto', height: '100vh' } },
    React.createElement('p', null, 'Browser fixture only; no native tasks launched.'),
    mode === 'list' ? React.createElement(TaskCollection, { items, runners: [], view, onViewChange: setView, onOpen: item => f.opened = item.id }) :
    mode === 'markdown' ? React.createElement(TaskMarkdown, { content: markdown(text, language), active: true, onOpenLink: url => f.link = url }) :
    React.createElement(RichDiff, { patch }));
}
(window.fixtureRoot ??= ReactDOM.createRoot(document.getElementById('root'))).render(React.createElement(React.StrictMode, null, React.createElement(Fixture)));
`;

const fixtureDirectory = join(
  process.env.JACKALOPE_SOURCE_ROOT ?? process.cwd(),
  'apps/desktop/scratch',
);
await mkdir(fixtureDirectory, { recursive: true });
await writeFile(join(fixtureDirectory, 'performance-fixture.tsx'), fixture);
let preview;
if (production) {
  const desktop = resolve(fixtureDirectory, '..');
  const require = createRequire(join(desktop, 'package.json'));
  const { build, preview: startPreview } = await import(
    pathToFileURL(require.resolve('vite')).href
  );
  const html = join(fixtureDirectory, 'performance-fixture.html');
  await writeFile(
    html,
    '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scratch/performance-fixture.tsx"></script></body></html>',
  );
  const outDir = resolve(output, 'dist');
  await build({
    root: desktop,
    configFile: join(desktop, 'vite.config.ts'),
    logLevel: 'warn',
    build: { outDir, emptyOutDir: true, rollupOptions: { input: html } },
  });
  const config = JSON.parse(await readFile(join(desktop, 'src-tauri/tauri.conf.json'), 'utf8'));
  preview = await startPreview({
    root: desktop,
    configFile: join(desktop, 'vite.config.ts'),
    build: { outDir },
    preview: {
      port: 5199,
      host: '127.0.0.1',
      strictPort: true,
      headers: { 'Content-Security-Policy': config.app.security.csp },
    },
  });
  url = 'http://127.0.0.1:5199/scratch/performance-fixture.html';
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  page.setDefaultTimeout(30_000);
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text());
  });
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'import "/scratch/performance-fixture.tsx";',
    }),
  );
  const start = performance.now();
  await page.goto(url);
  await page.locator('#work-item-idea-999').waitFor({ state: 'attached' });
  const listReadyMs = performance.now() - start;
  console.log('Task list loaded');
  await page.locator('#work-item-idea-999').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.performanceFixture.opened), 'idea-999');
  await page.getByRole('textbox', { name: 'Search tasks' }).fill('Searchable history 999');
  assert.equal(await page.locator('.work-item').count(), 1);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  assert.equal(await page.locator('.work-item').count(), 1000);
  console.log('Task search and board passed');
  await page.evaluate(() => window.performanceFixture.mode('markdown'));
  await page.waitForFunction(() =>
    document.querySelector('code')?.textContent?.includes('const value = 1;'),
  );
  await page.waitForFunction(() => document.querySelectorAll('code span[style]').length > 0);
  assert.equal(await page.locator('[data-injected]').count(), 0);
  await page.evaluate(() =>
    window.performanceFixture.text(
      window.performanceFixture.code.replace('value = 1', 'value = 2'),
    ),
  );
  await page.waitForFunction(() =>
    document.querySelector('code')?.textContent?.includes('const value = 2;'),
  );
  await page.getByRole('button', { name: 'Open link', exact: true }).click();
  assert.equal(await page.evaluate(() => window.performanceFixture.link), 'https://example.com/');
  for (const language of ['rust', 'cpp', 'tsx', 'python', 'emacs-lisp', 'vue', 'typescript']) {
    await page.evaluate((language) => window.performanceFixture.language(language), language);
    await page.getByText(language, { exact: true }).first().waitFor();
    await page.waitForFunction(() => document.querySelectorAll('code span[style]').length > 0);
    assert.match(await page.locator('code').innerText(), /const value = 2;/);
  }
  for (const width of [1280, 960]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ reducedMotion: theme === 'light' ? 'reduce' : 'no-preference' });
      await page.evaluate((theme) => window.performanceFixture.theme(theme), theme);
      await page.screenshot({ path: `${output}/markdown-${width}-${theme}.png` });
    }
  }
  const diffStart = performance.now();
  await page.evaluate(() => window.performanceFixture.mode('diff'));
  await page.getByRole('region', { name: 'Code changes' }).waitFor();
  const diffControlsReadyMs = performance.now() - diffStart;
  await page.getByRole('button', { name: 'Unified view' }).click();
  await page.getByRole('button', { name: 'Wrap lines' }).click();
  await page.getByRole('button', { name: 'Original patch' }).click();
  assert.match(await page.locator('.rich-diff-raw').innerText(), /value9999 = 9999/);
  await page.getByRole('button', { name: 'Original patch' }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('diffs-container')].some((element) =>
      element.shadowRoot?.querySelector('code')?.textContent?.includes('value0'),
    ),
  );
  const diffHighlightedMs = performance.now() - diffStart;
  for (const width of [1280, 960]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ reducedMotion: theme === 'light' ? 'reduce' : 'no-preference' });
      await page.evaluate((theme) => window.performanceFixture.theme(theme), theme);
      await page.locator('.rich-diff-scroll').focus();
      await page.keyboard.press('Home');
      await page.screenshot({ path: `${output}/diff-${width}-${theme}.png` });
    }
  }

  const longTasks = await page.evaluate(() => window.performanceFixture.longTasks);
  assert.deepEqual(errors, []);
  const receipt = {
    kind: 'Browser fixtures; no native execution or installed acceptance',
    listReadyMs,
    diffControlsReadyMs,
    diffHighlightedMs,
    longTasks,
    errors,
  };
  await writeFile(`${output}/receipt.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  console.error(await page?.locator('body').innerText());
  await page?.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => (preview ? preview.httpServer.close(resolve) : resolve()));
}
