import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const url = process.env.JACKALOPE_VERIFY_URL || 'http://127.0.0.1:5197';
const output = 'output/playwright/worktree-lifecycle';
await mkdir(output, { recursive: true });
const fixture = String.raw`
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import { ProjectGitSettings } from '/src/components/projects/ProjectGitSettings.tsx';
import { WorktreeManager } from '/src/components/projects/WorktreeManager.tsx';
import { MergeReview } from '/src/components/tasks/MergeReview.tsx';
import { useProjectStore } from '/src/stores/projectStore.ts';
import { useThemeStore } from '/src/stores/themeStore.ts';
import '/src/index.css';
import '/src/components/settings/settings.css';
import '/src/components/tasks/task-workspace.css';
import '/src/components/tasks/task-experience.css';
import '/src/components/tasks/project-queue.css';
import '/src/components/ui/experience.css';
const project = {id:'fixture',name:'Sample project',path:'C:/fixture/project',gitBranch:'main',agentProvider:'codex',worktrees:[]};
const run = {id:'run-1',taskId:'task-1',projectId:project.id,projectPath:project.path,workspace:project.path+'/.worktrees/task',branch:'jackalope/task',agent:'codex',prompt:'Add keyboard search',result:'Added keyboard search.',status:'review',startedAt:'2026-09-09T12:00:00Z'};
let policy = JSON.parse(localStorage.getItem('fixture-policy') || 'null') || {attribution:'user',name:'Sample User',email:'sample@example.test',cleanupAfterMerge:true,autoCheckpoint:true};
const row = (name, extra={}) => ({path:project.path+'/.worktrees/'+name,branch:name,head:'abcdef123',is_bare:false,is_locked:false,cleanup:{target_branch:'main',target_head:'target123',merged:true,blocked_reason:null,...extra}});
let trees = [{path:project.path,branch:'main',head:'target123',is_bare:false,is_locked:false},row('locked-folder'),row('copied-work',{merged:false,content_merged:true}),row('local-notes',{blocked_reason:'Local ignored content needs preserving: .env',merged:true})];
let plans = [];
window.fixtureCalls = [];
window.__TAURI_INTERNALS__ = {invoke: async (command,args={}) => {
  window.fixtureCalls.push({command,args});
  if (command==='project_git_policy') { if(args.policy){policy=args.policy;localStorage.setItem('fixture-policy',JSON.stringify(policy));}return {...policy}; }
  if(command==='git_list_worktrees')return trees;
  if(command==='git_cleanup_worktree') { if(args.worktreePath.endsWith('locked-folder'))throw new Error('Directory not empty: close the process using locked-folder, then retry.');trees=trees.filter(row=>row.path!==args.worktreePath);return; }
  if(command==='integration_plans')return plans;
  if(command==='integration_prepare') { const plan={id:'plan-1',projectPath:project.path,masterHead:'abcdef123',targetBranch:'main',integrationHead:'review123',runIds:[run.id],files:['search.ts'],patch:'diff --git a/search.ts b/search.ts\nnew file mode 100644\n--- /dev/null\n+++ b/search.ts\n@@ -0,0 +1 @@\n+export const search = true;\n',conflicts:[],status:'ready',createdAt:'2026-09-09T12:00:00Z',appliedAt:null,commitMessage:args.commitMessage||'Add keyboard search',commitPolicy:policy};plans=[plan];return plan; }
  if(command==='integration_apply'){const removed=plans[0].status==='applied';plans=[{...plans[0],status:'applied',cleanupRequested:args.cleanup,cleanupResults:[{workspace:run.workspace,removed,error:removed?null:'Directory not empty. Close its terminal and retry.'}]}];return plans[0];}
  throw new Error('Unexpected fixture command: '+command);
}};
useProjectStore.setState({projects:[project],activeProjectId:project.id});
function Fixture(){const [view,setView]=React.useState('settings');const [merged,setMerged]=React.useState([]);return React.createElement('main',{style:{height:'100vh',overflow:'auto',padding:24}},React.createElement('div',{style:{maxWidth:880,margin:'0 auto'}},React.createElement('p',{className:'task-muted'},'Browser fixture; no native tasks launched.'),React.createElement('nav',{'aria-label':'Fixture views',className:'flex gap-3 min-h-11'},...['settings','worktrees','review'].map(name=>React.createElement('button',{key:name,onClick:()=>setView(name)},name))),view==='settings'?React.createElement(ProjectGitSettings,{projectPath:project.path}):view==='worktrees'?React.createElement(WorktreeManager,{onOpenProject:()=>{}}):React.createElement(MergeReview,{project,runs:[run],items:[],merged,onChanged:async()=>setMerged([run.id]),onlyRunId:run.id})));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));
window.fixtureTheme = mode => {const state=useThemeStore.getState();state.setAppTheme({...state.appTheme,appearance:'manual',isDark:mode==='dark'});};
`;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const width of [1280, 960]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 1280 ? 840 : 640 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(message.text());
    });
    await page.route('**/src/main.tsx*', async (route) => {
      const original = await (await route.fetch()).text();
      const react = original.match(/from "([^" ]*\/react\.js[^" ]*)"/)[1];
      const dom = original.match(/from "([^" ]*\/react-dom_client\.js[^" ]*)"/)[1];
      await route.fulfill({
        contentType: 'text/javascript',
        body: fixture
          .replaceAll('/node_modules/.vite/deps/react.js', react)
          .replaceAll('/node_modules/.vite/deps/react-dom_client.js', dom),
      });
    });
    await page.goto(url);
    await page
      .getByRole('radio', { name: /Only me/ })
      .waitFor()
      .catch(async (error) => {
        console.log(await page.locator('body').innerText());
        console.log(
          await page.locator('input').evaluateAll((nodes) => nodes.map((node) => node.outerHTML)),
        );
        await page.screenshot({ path: `${output}/failure.png` });
        throw error;
      });
    await page.getByRole('radio', { name: /Only me/ }).focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.getByRole('radio', { name: /Me \+ agents/ }).isChecked(), true);
    await page.getByRole('button', { name: 'Save commit settings' }).click();
    await page.getByText('Commit settings saved for this repository.').waitFor();
    await page.reload();
    await page.getByRole('radio', { name: /Me \+ agents/ }).waitFor();
    assert.equal(await page.getByRole('radio', { name: /Me \+ agents/ }).isChecked(), true);
    for (const mode of ['light', 'dark']) {
      await page.evaluate((mode) => window.fixtureTheme(mode), mode);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({ path: `${output}/settings-${mode}-${width}.png` });
    }
    await page.getByRole('button', { name: 'worktrees', exact: true }).click();
    await page.getByRole('button', { name: 'Clean up ready (2)' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Clean up ready', exact: true })
      .click();
    await page.getByText('Removed 1 of 2 worktrees.', { exact: false }).waitFor();
    assert.equal(await page.getByText('copied-work', { exact: true }).count(), 0);
    assert.equal(await page.getByText('local-notes', { exact: true }).count(), 1);
    assert.match(await page.getByRole('alert').first().textContent(), /locked-folder/);
    const removals = await page.evaluate(() =>
      window.fixtureCalls.filter((c) => c.command === 'git_cleanup_worktree'),
    );
    assert.equal(removals.length, 2);
    assert.equal(
      removals.every(
        (c) =>
          c.args.deleteBranch === true &&
          c.args.expectedBranch === c.args.worktreePath.split('/').at(-1),
      ),
      true,
    );
    await page.screenshot({ path: `${output}/cleanup-${width}.png` });
    await page.getByRole('button', { name: 'review', exact: true }).click();
    await page.getByLabel('Commit message', { exact: true }).fill('Enable keyboard search');
    await page.getByRole('button', { name: 'Preview 1 task together' }).click();
    await page.getByText('Enable keyboard search', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Merge 1 task into main' }).click();
    await page.getByText('The merge is complete.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Retry cleanup' }).waitFor();
    await page.getByText('Opening diff…', { exact: true }).waitFor({ state: 'hidden' });
    await page.locator('main').evaluate((element) => element.scrollTo(0, 0));
    await page.screenshot({ path: `${output}/receipt-${width}.png` });
    await page.getByRole('button', { name: 'Retry cleanup' }).click();
    await page.getByText('Removed worktree and branch:', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Retry cleanup' }).count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    'Browser fixtures passed: attribution persistence, keyboard, themes, narrow layouts, bulk failures and merge receipts.',
  );
} finally {
  await browser.close();
}
