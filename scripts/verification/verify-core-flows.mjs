import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5188';
const output = 'output/playwright/core-flows';
await mkdir(output, { recursive: true });
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {Shell} from '/src/components/layout/Shell.tsx';
import {TaskPreview} from '/src/components/tasks/TaskPreview.tsx';
import {TaskDelivery} from '/src/components/tasks/TaskDelivery.tsx';
import {useExecutionStore} from '/src/stores/executionStore.ts';
import {useProjectStore} from '/src/stores/projectStore.ts';
import {useLiveSessionStore} from '/src/stores/liveSessionStore.ts';
import {useWorkViewStore} from '/src/stores/workViewStore.ts';
import {applyThemeTokens,DEFAULT_THEME} from '/node_modules/@jackalope/brand/src/theme.ts';
import '/src/index.css';
import '/src/components/tasks/task-workspace.css';
import '/src/components/ui/experience.css';
import '/src/components/tasks/task-detail.css';
const base={id:'sample',taskId:'sample',projectId:'atlas',projectName:'Atlas',projectPath:'C:/Projects/atlas',workspace:'C:/Projects/atlas-task',branch:'task/search',targetBranch:'main',baseHead:'abc',agent:'codex',account:'Personal',model:'Example model',prompt:'Make search easier with a keyboard',status:'review',startedAt:'2026-09-11T12:00:00Z',endedAt:'2026-09-11T12:02:00Z',sessionId:'session',result:'Search supports arrow keys.',activity:[],diagnostics:[],error:null,persistenceError:null,exitCode:0,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,reported:false,estimatedCostUsd:null}};
useProjectStore.setState({projects:[{id:'atlas',name:'Atlas',path:base.projectPath,gitBranch:'main',worktrees:[],agentProvider:'codex'},{id:'orbit',name:'Orbit',path:'C:/Projects/orbit',gitBranch:'main',worktrees:[],agentProvider:'codex'}],activeProjectId:'atlas'});
useExecutionStore.setState({runs:[base,{...base,id:'blocked',taskId:'blocked',prompt:'Export reports as CSV',status:'review',verificationError:'Project check failed'},{...base,id:'orbit-task',taskId:'orbit-task',projectId:'orbit',projectName:'Orbit',prompt:'Improve billing'}],runners:[{id:'codex',name:'Codex',available:true,signedIn:true,version:'Fixture',path:'fixture'}],selectedId:null,drafts:{},loading:false,error:null,refresh:async()=>{},discover:async()=>{},start:async()=>{throw new Error('Fixture execution disabled')}});
useLiveSessionStore.setState({sessions:[{id:'live',title:'Live keyboard exploration',request:{projectId:'atlas',projectName:'Atlas'},createdAt:base.startedAt,updatedAt:base.startedAt,paused:true,closed:false,pinned:false,messages:[],batches:[],draft:{text:'',revision:0},error:null}],runs:[],loading:false,refresh:async()=>{}});
const f=window.coreFixture={calls:[],preview:null,feedback:'',handoff:'',theme:appearance=>applyThemeTokens({...DEFAULT_THEME,isDark:appearance==='dark'}),view:()=>useWorkViewStore.getState(),preferences:()=>useProjectStore.getState().projects[0].preferences};
f.theme('dark');
const mode=new URLSearchParams(location.search).get('mode');
if(mode) window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
 f.calls.push({...args,command});
 if(command==='task_preview_status')return structuredClone(f.preview);
 if(command==='project_readiness')return {previewCommand:'pnpm run dev -- --port {port} --host 127.0.0.1'};
 if(command==='task_preview_start')return f.preview={running:true,ready:false,port:61234,command:args.command,output:'Starting fixture',exitCode:null};
 if(command==='task_preview_stop'){f.preview=null;return;}
 if(command==='task_delivery_status')return {head:'local-head',branch:'task/search',changed:true,upstream:'origin/task/search',ahead:1,behind:0,pullRequest:args.remote?{url:'https://github.com/example/example/pull/1',state:'OPEN',headRefOid:'different-head',statusCheckRollup:[{name:'Build',conclusion:'FAILURE'}]}:null,remoteNote:'Fixture state only',checkedAt:'2026-09-11T12:00:00Z'};
 throw new Error('Unexpected fixture command: '+command);
}};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,
React.createElement('p',{style:{position:'fixed',bottom:0,right:4,zIndex:90,fontSize:10,color:'var(--color-text-secondary)',pointerEvents:'none'}},'Browser fixture only; no native execution'),
mode?React.createElement('main',{style:{height:'100vh',overflow:'auto',padding:24}},mode==='preview'?React.createElement(TaskPreview,{run:base,onFeedback:text=>{f.feedback=text}}):React.createElement(TaskDelivery,{run:base,onHandoff:text=>{f.handoff=text}})):React.createElement(Shell)));
`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/src/main.tsx*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fixture }),
  );
  await page.route('http://127.0.0.1:61234/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Local preview fixture</h1><button>Save changes</button>',
    }),
  );
  await page.goto(url);
  await page.getByRole('heading', { name: 'Chat', exact: true }).waitFor();
  const taskTabs = page.getByRole('navigation', { name: 'tasks views', exact: true });
  assert.deepEqual(await taskTabs.getByRole('button').allTextContents(), [
    'Chat',
    'Inbox',
    'Evidence',
    'Recurring',
  ]);
  await taskTabs.getByRole('button', { name: 'Inbox', exact: true }).click();
  await page.getByRole('heading', { name: 'Work in Atlas', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Improve billing/ }).count(), 0);
  await page.locator('.work-item').filter({ hasText: 'Live keyboard exploration' }).waitFor();
  const rows = page.locator('.work-item');
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await rows.nth(1).evaluate((node) => node === document.activeElement), true);
  for (const width of [1280, 960]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const appearance of ['light', 'dark']) {
      await page.evaluate((value) => window.coreFixture.theme(value), appearance);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector('.work-item')).color ===
          getComputedStyle(document.querySelector('.task-home')).color,
      );
      await page.locator('.task-home').evaluate((node) => {
        node.scrollTop = 0;
      });
      assert(
        await rows
          .first()
          .evaluate(
            (node) =>
              node.getBoundingClientRect().bottom <=
              document.querySelector('.task-home').getBoundingClientRect().bottom,
          ),
        'Attention work must be visible on entry',
      );
      await page.screenshot({ path: `${output}/home-${width}-${appearance}.png` });
    }
  }
  await page.getByRole('searchbox', { name: 'Search tasks', exact: true }).fill('Export');
  await page.getByRole('combobox', { name: 'Filter by project', exact: true }).click();
  await page.getByRole('option', { name: 'All work · every project', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search tasks', exact: true }).fill('billing');
  await page.reload();
  await page.getByRole('heading', { name: 'Chat', exact: true }).waitFor();
  await page
    .getByRole('navigation', { name: 'tasks views', exact: true })
    .getByRole('button', { name: 'Inbox', exact: true })
    .click();
  await page.getByRole('heading', { name: 'All work', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('searchbox', { name: 'Search tasks', exact: true }).inputValue(),
    'billing',
  );
  await page.locator('.work-item').filter({ hasText: 'Improve billing' }).waitFor();
  await page.getByRole('combobox', { name: 'Filter by project', exact: true }).click();
  await page.getByRole('option', { name: 'Atlas · project work', exact: true }).click();
  assert.equal(
    await page.getByRole('searchbox', { name: 'Search tasks', exact: true }).inputValue(),
    'Export',
  );
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog');
  await palette.getByRole('searchbox', { name: 'Search commands' }).fill('keyboard');
  await palette.getByRole('button', { name: /Live keyboard exploration/ }).waitFor();
  await palette.getByRole('searchbox', { name: 'Search commands' }).fill('Orbit');
  await palette.getByRole('button', { name: 'Orbit', exact: true }).click();
  await page.getByRole('heading', { name: 'Orbit', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/project-overview.png` });
  await page.goto(`${url}/?mode=preview`);
  await page.getByRole('button', { name: 'Detect preview command' }).click();
  assert.equal(
    await page.evaluate(() =>
      window.coreFixture.calls.some((call) => call.command === 'task_preview_start'),
    ),
    false,
  );
  await page.getByRole('button', { name: 'Start preview', exact: true }).click();
  await page.getByText('Starting · waiting for the local server', { exact: true }).waitFor();
  assert.equal(await page.locator('iframe').count(), 0);
  assert.equal(
    await page.evaluate(
      () => window.coreFixture.calls.find((call) => call.command === 'task_preview_start').port,
    ),
    0,
  );
  assert.match(
    await page.evaluate(() => window.coreFixture.preferences().previewCommand),
    /\{port\}/,
  );
  await page.evaluate(() => {
    window.coreFixture.preview.ready = true;
  });
  await page.getByText('Ready · local server responding', { exact: true }).waitFor();
  await page
    .frameLocator('iframe')
    .getByRole('heading', { name: 'Local preview fixture' })
    .waitFor();
  await page.getByRole('button', { name: 'Use phone width' }).click();
  await page
    .getByRole('textbox', { name: 'What should change?' })
    .fill('Make the Save button easier to find.');
  await page.getByRole('button', { name: 'Add to follow-up' }).click();
  assert.match(await page.evaluate(() => window.coreFixture.feedback), /phone width.*390px/);
  await page.screenshot({ path: `${output}/preview-feedback.png` });
  await page.getByRole('button', { name: 'Stop preview', exact: true }).click();
  await page.getByRole('button', { name: 'Start preview', exact: true }).waitFor();
  await page.goto(`${url}/?mode=delivery`);
  await page.getByRole('button', { name: 'Check PR and CI' }).click();
  await page
    .getByText('The PR head differs from the inspected local revision.', { exact: false })
    .waitFor();
  await page.getByRole('button', { name: 'Prepare a deployment' }).click();
  assert.match(await page.evaluate(() => window.coreFixture.handoff), /Do not commit, push/);
  assert.equal(
    await page.evaluate(() =>
      window.coreFixture.calls.some((call) => /push|deploy|create/.test(call.command)),
    ),
    false,
  );
  await page.screenshot({ path: `${output}/delivery.png` });
  assert.deepEqual(errors, []);
  console.log(
    'Core flow browser fixtures passed: scoped unified work, visible attention items, keyboard navigation, project/task search, preview setup/readiness/feedback and guarded delivery drafts. No native execution.',
  );
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) {
    console.error(await page.locator('body').innerText());
    await page.screenshot({ path: `${output}/failure.png` });
  }
  throw error;
} finally {
  await browser.close();
}
