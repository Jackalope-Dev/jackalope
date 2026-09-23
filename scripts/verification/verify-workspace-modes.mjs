import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from '../../apps/desktop/node_modules/vite/dist/node/index.js';

const directory = path.resolve('apps/desktop/scratch/workspace-modes');
const output = path.resolve('output/playwright/workspace-modes');
mkdirSync(directory, { recursive: true });
mkdirSync(output, { recursive: true });
writeFileSync(
  path.join(directory, 'index.html'),
  '<div id="root"></div><script type="module" src="./fixture.tsx"></script>',
);
writeFileSync(
  path.join(directory, 'fixture.tsx'),
  `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {applyThemeTokens,DEFAULT_THEME} from '@jackalope/brand/theme';
import {Shell} from '../../src/components/layout/Shell';
import {useProjectStore} from '../../src/stores/projectStore';
import {useExecutionStore} from '../../src/stores/executionStore';
import {useLiveSessionStore} from '../../src/stores/liveSessionStore';
import {useWorkbenchStore} from '../../src/stores/workbenchStore';
import {useWorkViewStore} from '../../src/stores/workViewStore';
import '../../src/index.css';
import '../../src/components/tasks/task-workspace.css';
import '../../src/components/ui/experience.css';
const params=new URLSearchParams(location.search);
applyThemeTokens({...DEFAULT_THEME,appearance:'manual',isDark:params.get('theme')!=='light'});
const project={id:'atlas',name:'Atlas',path:'C:/Fixture/atlas',gitBranch:'main',preferences:{},worktrees:[]};
const run=(id,status,prompt,extra={})=>({id,taskId:id,projectId:'atlas',projectName:'Atlas',projectPath:project.path,workspace:project.path+'/.worktrees/'+id,branch:'task/'+id,baseHead:'fixture',agent:'codex',account:'Fixture',prompt,status,startedAt:'2026-09-21T12:00:00Z',endedAt:status==='running'?null:'2026-09-21T12:03:00Z',sessionId:'fixture-session',result:'Fixture result for layout checks only.',activity:[],diagnostics:[],prompts:[],usage:{input:0,output:0,reported:false},...extra});
const runs=params.has('empty')?[]:[run('review','review','Simplify the project overview'),run('running','running','Improve keyboard navigation'),run('chat-batch','review','Add a status bar',{liveSessionId:'chat'})];
useProjectStore.setState({projects:[project],activeProjectId:'atlas'});
useExecutionStore.setState({runs,loading:false,selectedId:null});
useLiveSessionStore.setState({runs:runs.filter(r=>r.liveSessionId),selectedId:null,sessions:params.has('empty')?[]:[{id:'chat',title:'Add a status bar',request:{id:'chat',projectId:'atlas',projectName:'Atlas',projectPath:project.path,agent:'codex',isolated:true},createdAt:'2026-09-21T12:00:00Z',updatedAt:'2026-09-21T12:03:00Z',paused:true,closed:false,pinned:false,error:null,messages:[{id:'message',text:'Add a status bar',createdAt:'2026-09-21T12:00:00Z',runId:'chat-batch',canceled:false}],batches:[{runId:'chat-batch',messageIds:['message'],previousRunId:null,error:null,settled:true}],draft:{text:'',revision:0}}]});
window.fixture={mode:()=>useWorkbenchStore.getState().presets.atlas,open:(id)=>useWorkViewStore.getState().open(id),draft:()=>useExecutionStore.getState().drafts['reply:review']?.prompt};
createRoot(document.getElementById('root')).render(<Shell/>);
`,
);
const server = await createServer({
  root: path.resolve('apps/desktop'),
  configFile: path.resolve('apps/desktop/vite.config.ts'),
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}/scratch/workspace-modes/index.html`;
  browser = await chromium.launch({
    channel: process.platform === 'win32' ? 'msedge' : 'chrome',
    headless: true,
  });
  for (const [theme, width, height] of [
    ['dark', 1280, 840],
    ['light', 960, 640],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}?theme=${theme}`);
    const switchMode = async (label) => {
      await page.getByRole('button', { name: 'Workspace layout' }).click();
      await page.getByRole('menuitem', { name: new RegExp(`^${label}`) }).click();
      await page.waitForFunction(
        (mode) => document.querySelector('.workspace-shell')?.getAttribute('data-mode') === mode,
        label.toLowerCase(),
      );
    };
    await page.getByRole('heading', { name: 'What will you focus on?' }).waitFor();
    assert.equal(await page.getByRole('navigation', { name: 'Recent work' }).count(), 0);
    assert.ok(
      (await page.locator('.workspace-navigation').evaluate((node) => node.clientWidth)) < 70,
    );
    await page.screenshot({ path: path.join(output, `focus-${theme}-${width}.png`) });
    await switchMode('Build');
    await page.getByRole('navigation', { name: 'Build tools' }).waitFor();
    await page.getByRole('navigation', { name: 'Recent work' }).waitFor();
    await page.screenshot({ path: path.join(output, `build-${theme}-${width}.png`) });
    await page.evaluate(() => window.fixture.open('review'));
    await switchMode('Build');
    await page.locator('.result-canvas[data-alongside="true"]').waitFor();
    const draft = page.locator('#task-reply');
    await draft.fill('Keep this unsent reply through mode changes.');
    await page.locator('.task-detail').evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.screenshot({ path: path.join(output, `build-task-${theme}-${width}.png`) });
    await switchMode('Focus');
    assert.equal(await draft.inputValue(), 'Keep this unsent reply through mode changes.');
    assert.equal(await page.locator('.result-canvas[data-alongside="true"]').count(), 0);
    await page.screenshot({ path: path.join(output, `focus-task-${theme}-${width}.png`) });
    await switchMode('Oversee');
    await page.getByRole('heading', { name: 'Oversee Atlas' }).waitFor();
    await page.locator('.work-board').waitFor();
    assert.equal(
      await page.locator('.oversee-counts button').first().locator('strong').textContent(),
      '2',
    );
    assert.equal(await page.locator('.task-home textarea').count(), 0);
    await page.screenshot({ path: path.join(output, `oversee-${theme}-${width}.png`) });
    await page.locator('.oversee-counts button').first().click();
    assert.equal(
      await page.locator('.oversee-counts button').first().getAttribute('aria-pressed'),
      'true',
    );
    await page.getByRole('searchbox', { name: 'Search tasks' }).fill('overview');
    await switchMode('Build');
    assert.equal(await page.getByRole('searchbox', { name: 'Search tasks' }).inputValue(), '');
    await switchMode('Oversee');
    assert.equal(
      await page.getByRole('searchbox', { name: 'Search tasks' }).inputValue(),
      'overview',
    );
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await page.getByRole('button', { name: 'Review next', exact: true }).click();
    await page.locator('.task-detail').waitFor();
    assert.equal(await draft.inputValue(), 'Keep this unsent reply through mode changes.');
    await page.evaluate(() => window.fixture.open('running'));
    await switchMode('Focus');
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
    await switchMode('Build');
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
    await page.evaluate(() => window.fixture.open('session:chat'));
    await switchMode('Build');
    await page.locator('.live-columns[data-expanded="true"]').waitFor();
    await switchMode('Focus');
    assert.equal(await page.locator('.live-columns[data-expanded="true"]').count(), 0);
    await switchMode('Oversee');
    await page.reload();
    await page.getByRole('heading', { name: 'Oversee Atlas' }).waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    for (const mode of ['Focus', 'Build', 'Oversee']) {
      await switchMode(mode);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page
        .locator('.workspace-statusbar')
        .getByRole('button', { name: /running/ })
        .click();
      await page.locator('.task-collection').waitFor();
      assert.equal(await page.getByRole('searchbox', { name: 'Search tasks' }).inputValue(), '');
      assert.deepEqual(
        await page.evaluate((mode) => {
          const saved = JSON.parse(localStorage.getItem('jackalope-work-views')).state;
          return { scope: saved.scope, filter: saved.views[`all:current:${mode}`]?.filter };
        }, mode.toLowerCase()),
        { scope: 'all', filter: 'attention' },
      );
      await page.getByRole('searchbox', { name: 'Search tasks' }).fill('no matching work');
      await page
        .locator('.workspace-statusbar')
        .getByRole('button', { name: /running/ })
        .click();
      assert.equal(await page.getByRole('searchbox', { name: 'Search tasks' }).inputValue(), '');
    }
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Desktop', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Search and commands shortcut', exact: true })
      .fill('Mod+Shift+1');
    await page.getByRole('button', { name: 'Save shortcuts', exact: true }).click();
    await page.keyboard.press('Control+Shift+Digit1');
    await page.getByRole('dialog', { name: 'Find work or run a command' }).waitFor();
    await page.getByRole('button', { name: 'Close commands', exact: true }).click();
    await page.reload();
    await page.getByRole('heading', { name: 'Activity across your projects' }).waitFor();
    await page.keyboard.press('Control+Shift+Digit1');
    await page.getByRole('dialog', { name: 'Find work or run a command' }).waitFor();
    await page.getByRole('button', { name: 'Close commands', exact: true }).click();
    assert.deepEqual(errors, []);
    await page.goto(`${origin}?empty&theme=${theme}`);
    await page.getByRole('heading', { name: 'Nothing waiting on you' }).waitFor();
    await page.getByRole('button', { name: 'New work', exact: true }).click();
    await page.locator('.task-home textarea').first().waitFor();
    await page.close();
  }
  console.log(
    'Workspace modes passed: distinct home layouts, task and chat switching, draft preservation, live Stop controls, counts, empty states, persistence and responsive themes. Browser fixtures only; no native execution.',
  );
} finally {
  await browser?.close();
  await server.close();
}
