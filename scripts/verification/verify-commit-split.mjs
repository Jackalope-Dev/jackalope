import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Renders the actual MergeReview with native-service fixtures for a ready
// integration and walks the commit split review: a helper fallback, a helper
// failure, a refused split, dismissal, an applied split and the merge receipt.
// Fixtures never prove that the helper or Git produced these results.
const url = process.env.JACKALOPE_PREVIEW_URL || 'http://127.0.0.1:5173';
const output = 'output/playwright/commit-split';
await mkdir(output, { recursive: true });
const fixture = String.raw`
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import { MergeReview } from '/src/components/tasks/MergeReview.tsx';
import { useProjectStore } from '/src/stores/projectStore.ts';
import { useThemeStore } from '/src/stores/themeStore.ts';
import '/src/index.css';
import '/src/components/tasks/task-workspace.css';
import '/src/components/tasks/task-experience.css';
import '/src/components/tasks/project-queue.css';
const project = {id:'fixture',name:'Sample project',path:'C:/fixture/project',gitBranch:'main',agentProvider:'codex',worktrees:[]};
const run = {id:'run-1',taskId:'task-1',projectId:project.id,projectPath:project.path,workspace:project.path+'/.worktrees/task',branch:'jackalope/task',agent:'codex',prompt:'Add keyboard search',result:'Added keyboard search.',status:'review',startedAt:'2026-09-09T12:00:00Z'};
const policy = {attribution:'user',name:'Sample User',email:'sample@example.test',cleanupAfterMerge:true,autoCheckpoint:true};
const patch = [
  'diff --git a/src/search.ts b/src/search.ts','--- a/src/search.ts','+++ b/src/search.ts','@@ -1,2 +1,3 @@',' export const a = 1;','+export const search = true;',' export const b = 2;',
  'diff --git a/tests/search.test.ts b/tests/search.test.ts','new file mode 100644','--- /dev/null','+++ b/tests/search.test.ts','@@ -0,0 +1 @@','+test("search", () => {});',
  'diff --git a/package.json b/package.json','--- a/package.json','+++ b/package.json','@@ -1 +1 @@','-{}','+{"dependencies":{"fuse":"1"}}',''
].join('\n');
const files = ['package.json','pnpm-lock.yaml','src/search.ts','tests/search.test.ts'];
const units = [
  {id:'h1',path:'package.json',added:1,removed:1,whole:true,lock:false},
  {id:'h2',path:'pnpm-lock.yaml',added:12,removed:0,whole:true,lock:true},
  {id:'h3',path:'src/search.ts',added:4,removed:1,whole:false,lock:false},
  {id:'h4',path:'src/search.ts',added:2,removed:0,whole:false,lock:false},
  {id:'h5',path:'src/search.ts',added:6,removed:2,whole:false,lock:false},
  {id:'h6',path:'tests/search.test.ts',added:20,removed:0,whole:true,lock:false},
];
const proposed = [
  {message:'Add fuzzy search dependency',hunks:['h1','h2'],files:['package.json','pnpm-lock.yaml'],dependsOn:[]},
  {message:'Search titles as you type\n\nTitles match before descriptions.',hunks:['h3','h5'],files:['src/search.ts'],dependsOn:[0]},
  {message:'Cover keyboard search with tests',hunks:['h4','h6'],files:['src/search.ts','tests/search.test.ts'],dependsOn:[0,1]},
];
let plans = [];
let proposals = 0;
let applies = 0;
let prepared = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
window.fixtureCalls = [];
window.__TAURI_INTERNALS__ = {invoke: async (command,args={}) => {
  window.fixtureCalls.push({command,args});
  if(command==='integration_plans')return plans;
  if(command==='integration_prepare'){prepared+=1;const plan={id:'plan-'+prepared,projectPath:project.path,masterHead:'abcdef123',targetBranch:'main',integrationHead:'review123',runIds:[run.id],files,patch,conflicts:[],status:'ready',createdAt:'2026-09-09T12:00:00Z',appliedAt:null,commitMessage:args.commitMessage||'Add keyboard search',commitPolicy:policy,commits:[]};plans=[plan];return plan;}
  if(command==='integration_split_propose'){
    proposals += 1;
    await wait(400);
    const base = {planId:args.planId,integrationHead:plans[0].integrationHead,hunks:units.length,units,fileLevel:false};
    if(proposals===1)return {...base,commits:[],fallback:'The change reads as one logical commit.'};
    if(proposals===2)throw new Error('No agent is available to draft a split. Connect an agent in Settings.');
    return {...base,commits:proposed.map(c=>({...c})),fallback:null};
  }
  if(command==='integration_split_apply'){
    applies += 1;
    await wait(200);
    if(applies===1)throw {message:'The split commits do not add up to the reviewed files.',code:'treeMismatch'};
    if(applies===2)throw {message:'The integration reference changed. Prepare a fresh review.',code:'reviewStale'};
    const commits = args.commits.map((c,i)=>({...c,commit:['1111111aaaa','2222222bbbb','3333333cccc'][i]}));
    plans=[{...plans[0],integrationHead:'split-tip',commits}];
    return plans[0];
  }
  if(command==='integration_apply'){plans=[{...plans[0],status:'applied',appliedAt:'2026-09-09T12:05:00Z',cleanupRequested:args.cleanup,cleanupResults:[{workspace:run.workspace,removed:true,error:null}]}];return plans[0];}
  throw new Error('Unexpected fixture command: '+command);
}};
useProjectStore.setState({projects:[project],activeProjectId:project.id});
function Fixture(){const [merged,setMerged]=React.useState([]);return React.createElement('main',{style:{height:'100vh',overflow:'auto',padding:24}},React.createElement('div',{style:{maxWidth:880,margin:'0 auto'}},React.createElement('p',{className:'task-muted'},'Browser fixture; no native tasks launched.'),React.createElement(MergeReview,{project,runs:[run],items:[],merged,onChanged:async()=>setMerged([run.id]),onlyRunId:run.id})));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));
window.fixtureTheme = mode => {const state=useThemeStore.getState();state.setAppTheme({...state.appTheme,appearance:'manual',isDark:mode==='dark'});};
`;

const browser = await chromium.launch({
  channel: process.env.UI_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chrome'),
  headless: true,
});
try {
  for (const [width, height] of [
    [1280, 840],
    [960, 640],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
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
    try {
      const shot = (name) => page.screenshot({ path: `${output}/${name}-${width}.png` });
      const merge = page.getByRole('button', { name: 'Merge into main and clean up' });
      const start = page.getByRole('button', { name: 'Split into commits' });

      await page.getByRole('button', { name: 'Preview merge' }).click();
      await page.getByText('One commit with all 4 files.').waitFor();
      await page.waitForFunction(() => !document.querySelector('.merge-approval button')?.disabled);

      // A helper fallback keeps the single commit and can be dismissed.
      await start.click();
      await page
        .getByRole('status')
        .filter({ hasText: 'Your default agent is grouping' })
        .waitFor();
      assert.equal(await merge.isDisabled(), true, 'merging waits while a split is drafted');
      await page
        .getByText('The change reads as one logical commit. The integration keeps one commit.')
        .waitFor();
      await page.waitForFunction(() => !document.querySelector('.merge-approval button')?.disabled);
      await page.getByRole('button', { name: 'Dismiss' }).click();
      await page.waitForFunction(() =>
        document.activeElement?.closest('button')?.textContent?.includes('Split into commits'),
      );

      // A helper failure is an error with a visible close control.
      await page.keyboard.press('Enter');
      await page
        .getByRole('alert')
        .filter({ hasText: 'Could not propose a split: No agent is available' })
        .waitFor();
      await page.getByRole('button', { name: 'Dismiss' }).click();

      // A proposal shows each commit's order, files, share of hunks and dependencies.
      await start.click();
      const review = page.getByRole('region', { name: 'Proposed commits' });
      await review.waitFor();
      await page.waitForFunction(
        () => document.activeElement?.getAttribute('aria-label') === 'Proposed commits',
      );
      await page.getByText('Proposed: 3 commits building the same 4 files.').waitFor();
      assert.equal(
        await review
          .getByRole('listitem')
          .filter({ has: page.locator('.commit-split-title') })
          .count(),
        3,
      );
      await review.getByText('Needs 1 and 2').waitFor();
      await review.getByText('2 of 3 hunks · +10 −3').waitFor();
      await review.getByText('lock file, kept with its manifest').waitFor();
      await review.getByText('Titles match before descriptions.').waitFor();
      assert.equal(await merge.isDisabled(), true, 'merging waits for the proposal to be resolved');
      for (const mode of ['light', 'dark']) {
        await page.evaluate((mode) => window.fixtureTheme(mode), mode);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        await shot(`proposal-${mode}`);
      }
      await page.evaluate(() => window.fixtureTheme('light'));

      // Messages are editable from the keyboard; Escape closes the editor.
      await review.getByRole('button', { name: 'Edit message for commit 1' }).click();
      const field = review.getByLabel('Message for commit 1');
      await field.fill('');
      await review.getByText('Every commit needs a message.').waitFor();
      assert.equal(await review.getByRole('button', { name: 'Use 3 commits' }).isDisabled(), true);
      await field.fill('Add the fuzzy search dependency');
      await field.press('Escape');
      assert.equal(
        await review.locator('.commit-split-title').first().textContent(),
        'Commit 1: Add the fuzzy search dependency',
      );

      // A refused split explains that nothing changed and keeps the review open.
      await review.getByRole('button', { name: 'Use 3 commits' }).click();
      await review.getByRole('alert').filter({ hasText: 'refused this split' }).waitFor();
      await shot('refused');
      assert.equal(await merge.isDisabled(), true);

      // Keeping one commit closes the review and returns focus to the start button.
      await review.getByRole('button', { name: 'Keep one commit' }).click();
      await page.waitForFunction(() =>
        document.activeElement?.closest('button')?.textContent?.includes('Split into commits'),
      );
      await page.waitForFunction(() => !document.querySelector('.merge-approval button')?.disabled);

      // A review whose reference moved points to a fresh review, not a new split.
      await start.click();
      await review.getByRole('button', { name: 'Use 3 commits' }).click();
      await review
        .getByRole('alert')
        .filter({ hasText: 'The integration reference changed. Prepare a fresh review.' })
        .waitFor();
      assert.equal(await review.getByRole('button', { name: 'Propose again' }).count(), 0);
      await review.getByRole('button', { name: 'Prepare a fresh review' }).click();
      await page.getByText('One commit with all 4 files.').waitFor();
      assert.equal(
        await page.evaluate(
          () => window.fixtureCalls.filter((call) => call.command === 'integration_prepare').length,
        ),
        2,
      );

      // An approved split replaces the commit, and the merge copy follows it.
      await start.click();
      await review.getByRole('button', { name: 'Use 3 commits' }).click();
      await page.getByText('Split into 3 commits, building the same files.').waitFor();
      await page.getByText('3 local commits on main', { exact: false }).waitFor();
      const applied = await page.evaluate(
        () =>
          window.fixtureCalls.filter((call) => call.command === 'integration_split_apply').at(-1)
            .args,
      );
      assert.equal(applied.integrationHead, 'review123');
      assert.deepEqual(
        applied.commits.map((commit) => commit.hunks),
        [
          ['h1', 'h2'],
          ['h3', 'h5'],
          ['h4', 'h6'],
        ],
      );
      await page.getByText('1111111a').waitFor();
      await page.getByRole('button', { name: 'Split differently' }).waitFor();
      for (const mode of ['light', 'dark']) {
        await page.evaluate((mode) => window.fixtureTheme(mode), mode);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        await shot(`split-${mode}`);
      }

      await merge.click();
      await page.getByText('Merged as 3 commits.').waitFor();
      assert.equal(await page.getByRole('button', { name: 'Split differently' }).count(), 0);
      await shot('merged');
    } catch (error) {
      console.log(await page.locator('body').innerText());
      await page.screenshot({ path: `${output}/failure-${width}.png` });
      throw error;
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    'Browser fixtures passed: split fallback, helper failure, refused split, stale review recovery, keyboard editing, dismissal, applied split, merge receipt, themes and narrow layout.',
  );
} finally {
  await browser.close();
}
