import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

// Walks the workspace page by page and menu by menu against fixtures and saves a screenshot
// of each, plus contact sheets for reviewing spacing, copy and flow in one pass. It asserts
// nothing and runs no agent: the browser preview has no native side, so pages that need it
// show their unavailable state. Needs the desktop preview (JACKALOPE_PREVIEW_URL).
//   node scripts/verification/capture-walkthrough.mjs [--theme dark] [--width 960]
const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5192';
const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : fallback;
};
const theme = option('theme', 'light');
const width = Number(option('width', '1280'));
const height = width >= 1280 ? 840 : 640;
const output = `output/playwright/walkthrough/${theme}-${width}`;
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

// The full-shell fixture the core flows check uses, so both show the same workspace.
const source = await readFile('scripts/verification/verify-core-flows.mjs', 'utf8');
// Added to it here: bots, followed pull requests and work in more states, so the walk
// reaches the screens an empty workspace never shows.
const extras = `
import {useBotStore} from '/src/stores/botStore.ts';
import {usePullRequestStore} from '/src/stores/pullRequestStore.ts';
const ago=h=>new Date(Date.now()-h*3600000).toISOString();
const bot=(id,name,role,style,color,agent)=>({id,name,role,instructions:role,agent,model:null,projectId:'atlas',connectionIds:null,routineIds:[],wakes:[],collaborate:true,pinned:false,createdAt:ago(90),updatedAt:ago(90),appearance:{style,color}});
useBotStore.setState({bots:[bot('scout','Scout','Keeps dependencies healthy','cat','teal','codex'),bot('reviewer','Reviewer','Reads every change before you do','ghost','violet','codex'),bot('scribe','Scribe','Writes release notes from merged work','gem','amber','codex')],selectedId:'scout',seen:{},seenFloor:ago(1000)});
const more=(id,prompt,extra={})=>({...base,id,taskId:id,prompt,...extra});
useExecutionStore.setState(state=>({runs:[...state.runs,more('pr-failing','Speed up the dashboard query'),more('pr-checking','Tidy the settings page'),more('pr-ready','Fix the cart total'),more('running','Migrate the price table',{status:'running',endedAt:null}),more('question','Rename the billing module',{status:'running',endedAt:null,prompts:[{id:'q1',question:'Keep the old import path as an alias?',status:'pending'}]})]}));
const pr=(taskId,phase,number,extra={})=>({taskId,runId:taskId,url:'https://github.com/example/atlas/pull/'+number,number,phase,failing:[],pending:0,checks:4,checkedAt:new Date(Date.now()+3600000).toISOString(),...extra});
usePullRequestStore.setState({tracked:{'pr-failing':pr('pr-failing','failing',11,{failing:['build']}),'pr-checking':pr('pr-checking','checking',12,{pending:2}),'pr-ready':pr('pr-ready','ready',13)}});
`;
const fixture = source
  .slice(source.indexOf('const fixture = `') + 17, source.indexOf('`;\nasync function applyTheme'))
  .replace("f.theme('dark');", `f.theme('${theme}');`)
  .replace('const mode=new URLSearchParams', `${extras}const mode=new URLSearchParams`);

const browser = await chromium.launch({
  channel: process.env.UI_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chrome'),
  headless: true,
});
const shots = [];
const skipped = [];
try {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(6000);
  await page.addInitScript(() => localStorage.setItem('jackalope.welcome.seen', '1'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/src/main.tsx*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fixture }),
  );
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.locator('.work-header-switch').waitFor({ timeout: 60000 });

  const slug = (text) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
  const shot = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(350);
    const file = `${String(shots.length + 1).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: path.join(output, file) });
    shots.push(file);
  };
  /** Runs one step; a step that cannot be reached is listed rather than stopping the walk. */
  const step = async (name, action) => {
    try {
      await action();
      await shot(name);
    } catch (error) {
      skipped.push(`${name}: ${String(error.message).split('\n')[0]}`);
    }
  };
  const dismiss = async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  };
  const button = (name) => page.getByRole('button', { name, exact: true }).first();
  const sidebar = page.getByRole('navigation', { name: 'Workspace', exact: true });
  const main = page.locator('#workspace-main, main').first();

  // Work: the list, its menus, the board and the composer.
  await step('work-list', async () => {});
  await step('work-project-switcher', () => page.locator('.work-header-switch').click());
  await dismiss();
  await step('work-status-filter', () =>
    page.getByRole('combobox', { name: 'Filter tasks by status' }).click(),
  );
  await dismiss();
  await step('work-actions-menu', () => button('Work actions').click());
  await dismiss();
  await step('work-board', () => button('Board').click());
  await button('List')
    .click()
    .catch(() => {});
  await step('work-composer', () => button('New work').click());
  await step('work-composer-agent', () =>
    page
      .locator('.live-start-composer')
      .getByRole('button', { name: /Automatic/ })
      .click(),
  );
  await dismiss();
  await step('work-composer-options', () =>
    page.locator('.live-start-composer').getByRole('button', { name: 'Options' }).click(),
  );
  await dismiss();
  await dismiss();
  // An open task and its tabs.
  // Opened from the keyboard: the list may still be settling, and a pointer click aimed at
  // a row's old position would open its neighbour.
  await step('task', async () => {
    await page.locator('.work-item', { hasText: 'Speed up the dashboard query' }).focus();
    await page.keyboard.press('Enter');
    await page.locator('.work-item').first().waitFor({ state: 'detached' });
  });
  // The headline action leads to the pull request when one is followed.
  await step('task-pull-request', () => button('Fix checks').click());
  for (const name of ['Review', 'Activity'])
    await step(`task-${slug(name)}`, () =>
      main.getByRole('tab', { name, exact: false }).first().click(),
    );
  await step('task-question', () =>
    page.locator('.work-sidebar-item', { hasText: 'Rename the billing' }).click(),
  );
  await step('inbox', () => sidebar.getByRole('button', { name: 'Inbox', exact: true }).click());
  await step('command-search', () => page.keyboard.press('Control+k'));
  await dismiss();
  await step('keyboard-shortcuts', () => page.keyboard.press('?'));
  await dismiss();

  // A project's own pages.
  await step('project-menu', () =>
    page
      .getByRole('button', { name: /Atlas options|Options for Atlas/ })
      .first()
      .click(),
  );
  await step('project-overview', () =>
    page.getByRole('menuitem', { name: 'Open project', exact: true }).click(),
  );
  const tabs = async (prefix) => {
    const track = main.locator('.ui-segmented, [class*="segmented"]').first();
    const names = (
      await track
        .getByRole('button')
        .allInnerTexts()
        .catch(() => [])
    )
      .map((text) => text.split('\n')[0].trim())
      .filter(Boolean);
    for (const name of names.slice(1))
      await step(`${prefix}-${slug(name)}`, () =>
        track.getByRole('button', { name, exact: true }).first().click(),
      );
  };
  await tabs('project');

  // Bots.
  await step('bots-overview', () => button('Bots').click());
  await step('bots-options', () => button('Bot options').click());
  await dismiss();
  await step('bots-new-bot', () => button('New bot').click());
  await dismiss();
  await step('bots-project', () => page.locator('.bots-project').first().click());
  await step('bots-project-options', () => button('Bot options').click());
  await step('bots-share', () =>
    page.getByRole('menuitem', { name: 'Share these bots…', exact: true }).click(),
  );
  await dismiss();
  await step('bots-row-menu', () =>
    page.locator('.bots-roster-item').nth(1).click({ button: 'right' }),
  );
  await dismiss();
  await button('Bots')
    .click()
    .catch(() => {});
  await tabs('bots');

  // Agents and its sub-pages.
  await step('agents', () => button('Agents').click());
  await step('agents-add', () => button('Add agent').click());
  await dismiss();
  await tabs('agents');

  // Settings: every section in its list.
  await step('settings', () => button('Settings').click());
  const sections = await page.locator('.settings-sidebar button').allInnerTexts();
  for (const [index, label] of sections.entries()) {
    if (index === 0) continue;
    await step(`settings-${slug(label)}`, async () => {
      await page.locator('.settings-sidebar button').nth(index).click();
    });
  }

  // Status bar and title bar.
  await step('status-usage', () => button('Usage & quota').click());
  await step('status-devices', () => button('Devices').click());
  await step('status-branch', () =>
    page.locator('.branch-indicator, [class*="branch"]').first().click(),
  );
  await dismiss();
  await step('companion', () =>
    page.locator('.companion-inline button, .companion button').first().click(),
  );
  await dismiss();

  // Contact sheets: twelve screens to a page, for a first look before opening any one.
  const sheet = (files, index) => `<!doctype html><meta charset="utf-8">
<style>body{margin:0;padding:12px;background:#1b1b1f;font:12px system-ui;color:#ddd;display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
figure{margin:0}img{width:100%;display:block;border-radius:4px}figcaption{padding:3px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style>
${files.map((file) => `<figure><img src="${file}"><figcaption>${file}</figcaption></figure>`).join('\n')}
<!-- sheet ${index} -->`;
  for (let index = 0; index * 12 < shots.length; index += 1) {
    const html = path.resolve(output, `sheet-${index + 1}.html`);
    await writeFile(html, sheet(shots.slice(index * 12, index * 12 + 12), index + 1));
    const view = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await view.goto(`file:///${html.replaceAll('\\', '/')}`);
    await view.screenshot({ path: path.join(output, `sheet-${index + 1}.png`), fullPage: true });
    await view.close();
  }
  console.log(`${shots.length} screens in ${output}`);
  if (skipped.length) console.log(`Not reached:\n  ${skipped.join('\n  ')}`);
  if (errors.length) console.log(`Page errors:\n  ${[...new Set(errors)].join('\n  ')}`);
} finally {
  await browser.close();
}
