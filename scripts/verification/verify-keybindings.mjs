import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Keyboard shortcuts in the workspace shell and the new-work composer: the defaults behave as
// before the registry, a binding changed in Settings works without a reload, and the composer
// pickers work from the keyboard. Fixture stores and a fake native bridge; nothing runs.
const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5281';
const output = 'output/playwright/keybindings';
await mkdir(output, { recursive: true });
const mac = process.platform === 'darwin';
const mod = mac ? 'Meta' : 'Control';
const modLabel = mac ? '⌘' : 'Ctrl';

const shellFixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {Shell} from '/src/components/layout/Shell.tsx';
import {useExecutionStore} from '/src/stores/executionStore.ts';
import {useProjectStore} from '/src/stores/projectStore.ts';
import {useLiveSessionStore} from '/src/stores/liveSessionStore.ts';
import {useOpenWorkStore} from '/src/stores/openWorkStore.ts';
import {useSettingsStore} from '/src/stores/settingsStore.ts';
import {useWorkViewStore} from '/src/stores/workViewStore.ts';
import {emitAppEvent} from '/src/lib/app-events.ts';
import {applyThemeTokens,DEFAULT_THEME} from '/node_modules/@jackalope/brand/src/theme.ts';
import '/src/index.css';
const base={id:'first',taskId:'first',projectId:'atlas',projectName:'Atlas',projectPath:'/Projects/atlas',workspace:'/Projects/atlas-first',branch:'task/first',targetBranch:'main',baseHead:'abc',agent:'codex',account:'Personal',prompt:'Search with the keyboard',status:'review',startedAt:'2026-11-20T12:00:00Z',endedAt:'2026-11-20T12:02:00Z',result:'Done.',activity:[],diagnostics:[],error:null,persistenceError:null,exitCode:0,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,reported:false,estimatedCostUsd:null}};
useProjectStore.setState({projects:[{id:'atlas',name:'Atlas',path:base.projectPath,gitBranch:'main',worktrees:[],agentProvider:'codex'}],activeProjectId:'atlas'});
useExecutionStore.setState({runs:[base,{...base,id:'second',taskId:'second',prompt:'Export reports as CSV'}],runners:[{id:'codex',name:'Codex',available:true,signedIn:true,version:'Fixture',path:'fixture'},{id:'claude',name:'Claude Code',available:true,signedIn:true,version:'Fixture',path:'fixture'}],selectedId:null,drafts:{},loading:false,error:null,refresh:async()=>{},discover:async()=>{},start:async()=>{throw new Error('Fixture execution disabled')}});
useLiveSessionStore.setState({sessions:[],runs:[],loading:false,refresh:async()=>{}});
useOpenWorkStore.setState({keys:['first','second']});
window.keysFixture={
 theme:appearance=>applyThemeTokens({...DEFAULT_THEME,isDark:appearance==='dark'}),
 saved:()=>useSettingsStore.getState().shortcuts,
 selected:()=>useExecutionStore.getState().selectedId,
 sidebarCollapsed:()=>useWorkViewStore.getState().navCollapsed,
 openShortcutSettings:()=>emitAppEvent('open-settings','Keyboard shortcuts'),
};
window.keysFixture.theme('light');
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,
 React.createElement('p',{style:{position:'fixed',bottom:0,right:4,zIndex:90,fontSize:10,pointerEvents:'none'}},'Browser fixture only; no native execution'),
 React.createElement('div',{className:'xterm',style:{position:'fixed',left:4,bottom:4,zIndex:90,width:120,height:24,opacity:0.6}},React.createElement('textarea',{'aria-label':'Fixture terminal input',style:{width:'100%',height:'100%'}})),
 React.createElement(Shell)));
`;

const composerFixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {SessionStart} from '/src/components/sessions/SessionStart.tsx';
import {useExecutionStore} from '/src/stores/executionStore.ts';
import {useProjectStore} from '/src/stores/projectStore.ts';
import {applyThemeTokens,DEFAULT_THEME} from '/node_modules/@jackalope/brand/src/theme.ts';
import '/src/index.css';
import '/src/components/tasks/task-workspace.css';
import '/src/components/tasks/core-workflow.css';
const project={id:'atlas',name:'Atlas',path:'/Projects/atlas',gitBranch:'main'};
useProjectStore.setState({projects:[project],activeProjectId:'atlas'});
useExecutionStore.setState({runners:[{id:'codex',name:'Codex',available:true,signedIn:true,version:'Fixture',path:'fixture'},{id:'claude',name:'Claude Code',available:true,signedIn:true,version:'Fixture',path:'fixture'}],runs:[],loading:false,refresh:async()=>{}});
const f=window.composerFixture={calls:[]};
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={transformCallback:()=>0,unregisterCallback:()=>{},metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},invoke:async(command,args={})=>{
 f.calls.push({command,...args});
 switch(command){
  case 'task_effort_levels': return ['low','medium','high'];
  case 'desktop_attach_support': return {drag:false,pick:false,badge:false};
  case 'plugin:event|listen': case 'plugin:event|unlisten': return 0;
  case 'knowledge_list': return [];
  case 'knowledge_preview': return {entries:[],bytes:0,reasons:{}};
  case 'agent_models': return {models:[{id:'fixture-large',name:'Fixture Large',isDefault:true},{id:'fixture-small',name:'Fixture Small'}]};
  case 'task_strategy_assess': throw new Error('Fixture: sending is not available here.');
  default: return null;
 }
}};
applyThemeTokens({...DEFAULT_THEME,isDark:false});
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement('main',{style:{padding:24,maxWidth:880}},
 React.createElement('button',{type:'button'},'Elsewhere'),
 React.createElement(SessionStart,{project,onOpenProject:()=>{}})));
`;

const browser = await chromium.launch({
  channel: process.env.UI_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chrome'),
  headless: true,
});
const errors = [];
async function open(fixture, viewport = { width: 1280, height: 840 }) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('jackalope.welcome.seen', '1'));
  await page.route('**/src/main.tsx*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fixture }),
  );
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  return page;
}
const focusBody = (page) =>
  page.evaluate(() => {
    document.activeElement?.blur?.();
    document.body.focus();
  });
const activeName = (page) =>
  page.evaluate(
    () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent,
  );

/** Waits for focus to land on the element named `name` (a string or pattern). */
async function expectFocus(page, name) {
  const deadline = Date.now() + 3000;
  let current = '';
  while (Date.now() < deadline) {
    current = (await activeName(page)) ?? '';
    if (typeof name === 'string' ? current === name : name.test(current)) return;
    await page.waitForTimeout(50);
  }
  assert.fail(`Focus is on "${current}", expected ${name}`);
}

try {
  const page = await open(shellFixture);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Search commands' }).waitFor();
  const palette = page.getByRole('dialog').filter({ has: page.getByPlaceholder(/Search/) });
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });

  // Defaults behave as before: the palette toggles, ? opens the sheet outside text fields.
  await focusBody(page);
  await page.keyboard.press(`${mod}+K`);
  await palette.waitFor();
  await page.keyboard.press(`${mod}+K`);
  await palette.waitFor({ state: 'hidden' });
  await page.keyboard.press('?');
  await sheet.waitFor();
  const searchRow = sheet.locator('dl > div').filter({ hasText: 'Search and commands' });
  assert.equal((await searchRow.locator('kbd').textContent()).trim(), `${modLabel}+K`);
  assert.ok(await sheet.getByText('Go to tab 1–9').isVisible());
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden' });

  await page.keyboard.press(`${mod}+B`);
  await page.waitForFunction(() => window.keysFixture.sidebarCollapsed() === true);
  await page.keyboard.press(`${mod}+B`);
  await page.waitForFunction(() => window.keysFixture.sidebarCollapsed() === false);

  const settingsNav = page.getByRole('button', { name: 'Settings', exact: true }).last();
  await page.keyboard.press(`${mod}+Comma`);
  await page.waitForFunction(() =>
    document.querySelector('.workspace-settings[aria-current="page"]'),
  );
  // Back returns to the work page, as the title bar's Back does.
  await page.keyboard.press(mac ? `${mod}+BracketLeft` : 'Alt+ArrowLeft');
  await page.waitForFunction(
    () => !document.querySelector('.workspace-settings[aria-current="page"]'),
  );
  assert.ok(settingsNav);

  await page.keyboard.press(`${mod}+Shift+O`);
  await page.locator('button[aria-label="Overview"][aria-current="page"]').waitFor();
  await page.keyboard.press(mac ? `${mod}+BracketLeft` : 'Alt+ArrowLeft');
  await page
    .locator('button[aria-label="Overview"][aria-current="page"]')
    .waitFor({ state: 'detached' });

  // Open work tabs: Mod+digit jumps, Ctrl+Tab cycles.
  await page.keyboard.press(`${mod}+2`);
  await page.waitForFunction(() => window.keysFixture.selected() === 'second');
  await page.keyboard.press('Control+Tab');
  await page.waitForFunction(() => window.keysFixture.selected() === 'first');
  await page.keyboard.press('Control+Shift+Tab');
  await page.waitForFunction(() => window.keysFixture.selected() === 'second');

  // Text fields and terminals keep typing keys; the terminal keeps what it uses.
  const terminal = page.getByLabel('Fixture terminal input');
  await terminal.focus();
  await page.keyboard.press('?');
  assert.equal(await sheet.count(), 0);
  assert.equal(await terminal.inputValue(), '?');
  await page.keyboard.press(`${mod}+Shift+G`);
  assert.equal(await page.getByRole('heading', { name: 'Project branches' }).count(), 0);
  // Mod chords the terminal lets through still reach the app, as before.
  await page.keyboard.press(`${mod}+K`);
  await palette.waitFor();
  await page.keyboard.press('Escape');
  await palette.waitFor({ state: 'hidden' });

  // The branch menu opens from the keyboard and closes with Escape.
  await focusBody(page);
  await page.keyboard.press(`${mod}+Shift+G`);
  await page.getByRole('heading', { name: 'Project branches' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'Project branches' }).waitFor({ state: 'hidden' });

  // Settings: rebinding takes effect at once, and a clash names the other action.
  await page.evaluate(() => window.keysFixture.openShortcutSettings());
  const searchSetting = page.locator('[data-action="search"]');
  await searchSetting.waitFor();
  await searchSetting.getByRole('button', { name: /^Record a shortcut for Search/ }).click();
  await page.keyboard.press(`${mod}+Shift+P`);
  await page.keyboard.press('Enter');
  const clash = searchSetting.getByRole('alert');
  await clash.waitFor();
  assert.match(await clash.textContent(), /already used by Turn plan mode on or off/);
  assert.match(await clash.textContent(), /Swap gives it/);
  await clash.getByRole('button', { name: 'Swap' }).click();
  await page.waitForFunction(() => window.keysFixture.saved().search === 'Mod+Shift+P');
  assert.deepEqual(await page.evaluate(() => window.keysFixture.saved()), {
    search: 'Mod+Shift+P',
    planMode: 'Mod+K',
  });
  await expectFocus(page, /Record a shortcut for Search and commands/);
  assert.equal(
    await searchSetting.getByRole('img').getAttribute('aria-label'),
    `${modLabel}+Shift+P`,
  );

  // A chord: Mod+G then S opens Settings.
  const settingsSetting = page.locator('[data-action="settings"]');
  await settingsSetting.getByRole('button', { name: /^Record a shortcut for Settings/ }).click();
  await page.keyboard.press(`${mod}+G`);
  await page.keyboard.press('S');
  await page.waitForFunction(() => window.keysFixture.saved().settings === 'Mod+G S');

  // Clearing leaves an action unassigned.
  const sidebarSetting = page.locator('[data-action="sidebar"]');
  await sidebarSetting.getByRole('button', { name: /^Clear the shortcut/ }).click();
  await sidebarSetting.getByText('Not set').waitFor();

  // Search filters the list.
  const searchField = page.getByRole('searchbox', { name: 'Search shortcuts' });
  await searchField.fill('branch');
  assert.equal(await page.locator('[data-action]').count(), 1);
  await searchField.fill('zzzz');
  await page.getByText('No shortcuts match').waitFor();
  await searchField.fill('');

  // Narrow widths and both themes, with keyboard focus on a row control.
  for (const width of [1280, 960, 680]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const appearance of ['light', 'dark']) {
      await page.evaluate((value) => window.keysFixture.theme(value), appearance);
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: appearance });
      const record = searchSetting.getByRole('button', { name: /^Record a shortcut for Search/ });
      await record.focus();
      await record.scrollIntoViewIfNeeded();
      const overflow = await page.evaluate(() => {
        const scroller = document.querySelector('[data-action="search"]')?.closest('main');
        return scroller ? scroller.scrollWidth - scroller.clientWidth : 0;
      });
      assert.ok(overflow <= 1, `Horizontal overflow at ${width}px: ${overflow}`);
      await page.screenshot({ path: `${output}/settings-${width}-${appearance}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.evaluate(() => window.keysFixture.theme('light'));

  // Back in the workspace, the new bindings work without a reload and the old ones are free.
  await page.keyboard.press(`${mod}+G`);
  await page.keyboard.press('S');
  await page.waitForFunction(
    () => !document.querySelector('.workspace-settings[aria-current="page"]'),
  );
  await focusBody(page);
  await page.keyboard.press(`${mod}+B`);
  assert.equal(await page.evaluate(() => window.keysFixture.sidebarCollapsed()), false);
  await page.keyboard.press(`${mod}+K`);
  assert.equal(await palette.count(), 0);
  await page.keyboard.press(`${mod}+Shift+P`);
  await palette.waitFor();
  // Command search and the sheet show the person's bindings.
  await page.keyboard.type('keyboard');
  const command = page.getByRole('button', { name: /Keyboard shortcuts/ });
  assert.equal((await command.locator('kbd').textContent()).trim(), '?');
  await command.click();
  await sheet.waitFor();
  assert.equal(
    (
      await sheet
        .locator('dl > div')
        .filter({ hasText: 'Search and commands' })
        .locator('kbd')
        .textContent()
    ).trim(),
    `${modLabel}+Shift+P`,
  );
  assert.equal(
    await sheet.locator('dl > div').filter({ hasText: 'Collapse or expand sidebar' }).count(),
    0,
  );
  await page.screenshot({ path: `${output}/sheet.png` });
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden' });

  // Import replaces the changes; a bad file names the problem and changes nothing.
  await page.evaluate(() => window.keysFixture.openShortcutSettings());
  await page.getByRole('button', { name: 'Import…' }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import shortcuts' });
  const json = importDialog.getByRole('textbox', { name: 'Shortcuts JSON' });
  await json.fill('{"bindings":{"search":"Mod+V"}}');
  await importDialog.getByRole('button', { name: 'Import', exact: true }).click();
  await importDialog.getByText(/Search and commands: .*reserved/).waitFor();
  await json.fill(
    '{"format":"jackalope-keybindings","version":1,"bindings":{"search":"Mod+Shift+K","later":"Mod+L"}}',
  );
  await importDialog.getByRole('button', { name: 'Import', exact: true }).click();
  await importDialog.waitFor({ state: 'hidden' });
  await page.getByText(/Skipped actions this version doesn’t have: later/).waitFor();
  assert.deepEqual(await page.evaluate(() => window.keysFixture.saved()), {
    search: 'Mod+Shift+K',
  });

  // Reset all brings back every default.
  await page.getByRole('button', { name: 'Reset all' }).click();
  assert.deepEqual(await page.evaluate(() => window.keysFixture.saved()), {});
  await page.keyboard.press(`${mod}+Comma`);
  await focusBody(page);
  await page.keyboard.press(`${mod}+K`);
  await palette.waitFor();
  await page.keyboard.press('Escape');
  await page.close();

  // The composer: keyboard actions open and operate its pickers.
  const composer = await open(composerFixture);
  const message = composer.getByRole('textbox', { name: 'Message' });
  await message.waitFor();
  await composer.getByRole('button', { name: 'Elsewhere' }).focus();
  await composer.keyboard.press(`${mod}+I`);
  await expectFocus(composer, 'Message');

  await composer.keyboard.press(`${mod}+Shift+M`);
  const agents = composer.getByRole('tablist', { name: 'Agents' });
  await agents.waitFor();
  await expectFocus(
    composer,
    'Use AutomaticRoutes each message by your project’s Decisions setting.',
  );
  await composer.keyboard.press('ArrowLeft');
  await expectFocus(composer, 'Automatic');
  await composer.keyboard.press('ArrowDown');
  await expectFocus(composer, 'Codex');
  await composer.keyboard.press('ArrowRight');
  await composer.getByText('Fixture Small').waitFor();
  await expectFocus(composer, /^Default model/);
  await composer.keyboard.press('ArrowDown');
  await composer.keyboard.press('ArrowDown');
  await expectFocus(composer, /^Fixture Small/);
  await composer.keyboard.press('Enter');
  await agents.waitFor({ state: 'hidden' });
  await composer.getByRole('button', { name: 'Agent: Codex · Fixture Small' }).waitFor();
  await expectFocus(composer, 'Message');
  // The same keys close it again.
  await composer.keyboard.press(`${mod}+Shift+M`);
  await agents.waitFor();
  await composer.keyboard.press(`${mod}+Shift+M`);
  await agents.waitFor({ state: 'hidden' });
  await expectFocus(composer, 'Message');

  await composer.keyboard.press(`${mod}+Shift+E`);
  const effort = composer.getByRole('group', { name: 'Effort' });
  await effort.waitFor();
  await expectFocus(composer, /^Default/);
  await composer.keyboard.press('End');
  await expectFocus(composer, /^High/);
  await composer.keyboard.press('ArrowUp');
  await expectFocus(composer, /^Medium/);
  await composer.keyboard.press('Enter');
  await effort.waitFor({ state: 'hidden' });
  await composer.getByRole('button', { name: 'Effort: Medium' }).waitFor();
  await expectFocus(composer, 'Message');

  await composer.keyboard.press(`${mod}+Shift+P`);
  await composer.getByText(/^Plan mode: Send starts/).waitFor();
  assert.equal(await message.getAttribute('placeholder'), 'What should we plan?');
  await composer.keyboard.press(`${mod}+Shift+P`);
  await composer.getByText(/^Plan mode: Send starts/).waitFor({ state: 'hidden' });

  // Mod+Enter sends from the composer.
  await message.fill('Add keyboard shortcuts');
  await composer.keyboard.press(`${mod}+Enter`);
  await composer.waitForFunction(() =>
    window.composerFixture.calls.some((call) => call.command === 'task_strategy_assess'),
  );
  await composer.screenshot({ path: `${output}/composer.png` });
  await composer.close();

  assert.deepEqual(errors, []);
  console.log('Keybindings fixture passed; screenshots in', output);
} finally {
  await browser.close();
}
