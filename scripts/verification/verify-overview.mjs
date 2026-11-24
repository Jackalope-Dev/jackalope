import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Renders the real Shell with fixture stores and checks Inbox's Running now rail and the
// Overview page: a conversation finished 41 days ago with an unsent message is not listed
// as running, rail headings line up with Needs you, overflow points at Overview, and
// Overview lists live work, project status, accounts near their limits and recent results.
// Fixtures never prove that native tasks, previews or account readers produced this state.
const url = process.env.JACKALOPE_PREVIEW_URL || 'http://127.0.0.1:5291';
const output = 'output/playwright/overview';
await mkdir(output, { recursive: true });
const fixture = String.raw`
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {Shell} from '/src/components/layout/Shell.tsx';
import {useExecutionStore} from '/src/stores/executionStore.ts';
import {useProjectStore} from '/src/stores/projectStore.ts';
import {useLiveSessionStore} from '/src/stores/liveSessionStore.ts';
import {useManagedTaskStore} from '/src/stores/managedTaskStore.ts';
import {useTaskStore} from '/src/stores/taskStore.ts';
import {useCapacityStore} from '/src/stores/capacityStore.ts';
import {usePullRequestStore} from '/src/stores/pullRequestStore.ts';
import {useWorkViewStore} from '/src/stores/workViewStore.ts';
import {useActivityStore} from '/src/stores/activityStore.ts';
import {applyThemeTokens,DEFAULT_THEME} from '/node_modules/@jackalope/brand/src/theme.ts';
import '/src/index.css';
const now=Date.now();
const ago=ms=>new Date(now-ms).toISOString();
const MIN=60_000,HOUR=60*MIN,DAY=24*HOUR;
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,reported:false,estimatedCostUsd:null};
const projects=[
 {id:'atlas',name:'Atlas',path:'/Projects/atlas',gitBranch:'main',icon:'rocket',worktrees:[],preferences:{baseBranch:'main',verifyCommand:'pnpm test'}},
 {id:'orbit',name:'Orbit',path:'/Projects/orbit',gitBranch:'develop',icon:'globe',worktrees:[]},
 {id:'perm-trial',name:'perm-trial',path:'/tmp/perm-trial',gitBranch:'main',worktrees:[]},
];
const run=(id,project,extra)=>({id,taskId:'t-'+id,projectId:project.id,projectName:project.name,projectPath:project.path,workspace:project.path+'/.worktrees/'+id,branch:'jackalope/'+id,baseHead:'abc',agent:'claude',account:'Personal',model:'claude-sonnet-4-5',prompt:id,status:'review',startedAt:ago(HOUR),endedAt:ago(HOUR-10*MIN),sessionId:null,result:'Done.',activity:[],diagnostics:[],error:null,persistenceError:null,exitCode:0,usage,...extra});
const [atlas,orbit,perm]=projects;
const verification=(success)=>({command:'pnpm test',checkedAt:ago(40*MIN),tree:'tree',result:{exitCode:success?0:1,success,timedOut:false,stdout:'',stderr:success?'':'2 tests failed',truncated:false,durationMs:42000}});
const runs=[
 run('search',atlas,{prompt:'Make search work with the keyboard',status:'running',startedAt:ago(14*MIN),endedAt:null,activity:['Reading src/search/index.ts','Editing src/search/keyboard.ts'],progress:{step:'agent',label:'Working',detail:'Editing src/search/keyboard.ts',startedAt:ago(3*MIN),attempt:1}}),
 run('refunds',orbit,{prompt:'Add a refund approval step',agent:'codex',model:'gpt-5.2-codex',status:'running',startedAt:ago(32*MIN),endedAt:null,activity:['Reading billing/refunds.ts'],prompts:[{id:'q1',runId:'refunds',question:'Should refunds over $500 need a second approval?',inputType:'choice',options:['Yes','No'],status:'pending',createdAt:ago(4*MIN)}]}),
 run('checking',atlas,{prompt:'Cache project thumbnails',agent:'codex',model:'gpt-5.2-codex',status:'running',finishing:true,startedAt:ago(9*MIN),endedAt:null,progress:{step:'verification',label:'Checking result',detail:'pnpm test -- thumbnails',startedAt:ago(MIN),attempt:1}}),
 run('nightly',atlas,{prompt:'Audit dependencies for advisories',status:'running',startedAt:ago(2*MIN),endedAt:null,progress:{step:'workspace',label:'Preparing workspace',detail:'pnpm install --frozen-lockfile',startedAt:ago(MIN),attempt:1}}),
 run('ready',atlas,{prompt:'Show unread counts in the sidebar',startedAt:ago(70*MIN),endedAt:ago(50*MIN)}),
 run('review-pr',orbit,{prompt:'Speed up invoice export',startedAt:ago(3*HOUR),endedAt:ago(160*MIN)}),
 run('pr-failing',orbit,{prompt:'Upgrade the payments SDK',agent:'codex',model:'gpt-5.2-codex',startedAt:ago(6*HOUR),endedAt:ago(5*HOUR)}),
 run('check-failed',orbit,{prompt:'Validate tax IDs on signup',agent:'codex',model:'gpt-5.2-codex',startedAt:ago(2*HOUR),endedAt:ago(100*MIN),verification:verification(false)}),
 run('merged',atlas,{prompt:'Fix the dark mode toggle flicker',status:'reviewed',startedAt:ago(3*HOUR),endedAt:ago(2*HOUR),verification:verification(true)}),
 run('merged-orbit',orbit,{prompt:'Add CSV export to reports',status:'reviewed',startedAt:ago(9*HOUR),endedAt:ago(7*HOUR),verification:verification(true)}),
 run('reviewer',atlas,{prompt:'Review: show unread counts',agent:'codex',model:'gpt-5.2-codex',status:'running',startedAt:ago(5*MIN),endedAt:null,challengeOf:{runId:'ready',tree:'tree',base:'abc',kind:'review'}}),
 run('worker-1',orbit,{prompt:'Split invoice totals by team',status:'running',startedAt:ago(20*MIN),endedAt:null,progress:{step:'agent',label:'Working',detail:'Editing invoices/teams.ts',startedAt:ago(2*MIN),attempt:1}}),
 run('worker-2',orbit,{prompt:'Team filter on the invoice list',agent:'codex',model:'gpt-5.2-codex',status:'running',startedAt:ago(18*MIN),endedAt:null}),
 run('planner',orbit,{prompt:'Plan: invoices by team',status:'reviewed',startedAt:ago(25*MIN),endedAt:ago(21*MIN)}),
];
// The misclassified item from the owner's screenshot: a conversation that was finished 41 days
// ago, with an answer typed into it later that was never sent (runId null).
const permRun=run('perm-run',perm,{prompt:'resume 02f4245e Always allow python3',agent:'auto',model:null,liveSessionId:'perm',startedAt:ago(41*DAY+2*HOUR),endedAt:ago(41*DAY+HOUR)});
const convRun=run('conv-run',atlas,{prompt:'Tidy the onboarding copy',liveSessionId:'conv',status:'running',startedAt:ago(6*MIN),endedAt:null,activity:['Reading src/onboarding/steps.tsx']});
const request=(project)=>({id:'r',projectId:project.id,projectName:project.name,projectPath:project.path,agent:'claude',prompt:'Live session',isolated:true});
const sessions=[
 {id:'perm',title:'resume 02f4245e-f796-4353-a8e0-b8cc79871beb Always allow '+String.fromCharCode(96)+'python3'+String.fromCharCode(96)+' commands in perm-trial',request:{...request(perm),agent:'auto'},createdAt:ago(41*DAY+2*HOUR),updatedAt:ago(21*DAY),paused:true,closed:true,pinned:false,error:'Review the last attempt before continuing.',draft:{text:'',revision:0},
  messages:[{id:'m1',text:'Always allow python3',createdAt:ago(41*DAY+2*HOUR),runId:'perm-run',canceled:false},{id:'m2',text:'My answer: Test',createdAt:ago(21*DAY),runId:null,canceled:false}],
  batches:[{runId:'perm-run',messageIds:['m1'],previousRunId:null,error:null,settled:true}]},
 {id:'conv',title:'Tidy the onboarding copy',request:request(atlas),createdAt:ago(30*MIN),updatedAt:ago(6*MIN),paused:false,closed:false,pinned:false,error:null,draft:{text:'',revision:0},
  messages:[{id:'c1',text:'Tidy the onboarding copy',createdAt:ago(6*MIN),runId:'conv-run',canceled:false}],
  batches:[{runId:'conv-run',messageIds:['c1'],previousRunId:null,error:null,settled:false}]},
];
const ideas=[
 {id:'d1',projectId:'atlas',title:'Offline mode',rawPrompt:'Offline mode for the reader',status:'backlog',createdAt:ago(2*DAY),updatedAt:ago(2*DAY)},
 {id:'d2',projectId:'atlas',title:'Keyboard help sheet',rawPrompt:'Keyboard help sheet',status:'backlog',createdAt:ago(3*DAY),updatedAt:ago(3*DAY)},
 {id:'d3',projectId:'orbit',title:'Dunning emails',rawPrompt:'Dunning emails',status:'backlog',createdAt:ago(DAY),updatedAt:ago(DAY)},
];
const managed={id:'plan-1',title:'Invoices by team',request:{...request(orbit),agent:'claude'},assessment:{},plannerRunId:'planner',runIds:[],createdAt:ago(25*MIN),started:true,error:null,plan:null,delivery:null};
const queueItem=(id,runId,title,agent)=>({id,featureId:'plan-1',projectId:'orbit',title,prompt:title,agent,scopes:[],dependencies:[],runId,error:null,canceled:false});
useProjectStore.setState({projects,activeProjectId:'atlas'});
useExecutionStore.setState({runs,runners:[{id:'claude',name:'Claude Code',available:true,signedIn:true},{id:'codex',name:'Codex',available:true,signedIn:true}],selectedId:null,drafts:{},loading:false,error:null,refresh:async()=>{},discover:async()=>{}});
useLiveSessionStore.setState({sessions,runs:[permRun,convRun],selectedId:null,loading:false,refresh:async()=>{}});
useManagedTaskStore.setState({queue:{managedTasks:[managed],items:[queueItem('i1','worker-1','Split invoice totals by team','claude'),queueItem('i2','worker-2','Team filter on the invoice list','codex')],messages:[],enabledProjects:['managed:plan-1'],concurrency:4,bridgeUrl:null,bridgeError:null,mergedRunIds:['merged','merged-orbit']}});
useTaskStore.setState({tasks:ideas});
usePullRequestStore.setState({tracked:{
 't-review-pr':{taskId:'t-review-pr',runId:'review-pr',url:'https://github.com/example/orbit/pull/42',number:42,phase:'checking',failing:[],pending:2,checks:6,checkedAt:ago(MIN)},
 't-pr-failing':{taskId:'t-pr-failing',runId:'pr-failing',url:'https://github.com/example/orbit/pull/41',number:41,phase:'failing',failing:['Build','Lint'],pending:0,checks:6,checkedAt:ago(2*MIN)},
}});
const window5h={poolId:'max',poolName:'Claude Max',window:'primary',usedPercent:88,remainingPercent:12,durationMinutes:300,resetsAt:Math.round(now/1000)+2*3600};
useCapacityStore.setState({lastFetched:now,lastAttempted:now,loading:false,error:null,records:[
 {agent:'claude',status:'reported',account:'Personal',source:'fixture',observedAt:new Date(now).toISOString(),detail:'',windows:[window5h,{...window5h,window:'weekly',usedPercent:36,remainingPercent:64,durationMinutes:10080,resetsAt:Math.round(now/1000)+3*86400}]},
 {agent:'codex',status:'reported',account:'Work',source:'fixture',observedAt:new Date(now).toISOString(),detail:'',windows:[{poolId:'plus',poolName:'ChatGPT Plus',window:'weekly',usedPercent:100,remainingPercent:0,durationMinutes:10080,resetsAt:Math.round(now/1000)+86400}]},
]});
useActivityStore.setState({schedules:{nightly:'Nightly dependency audit'},previews:{ready:61234},previewError:null});
const f=window.overviewFixture={
 selected:()=>useExecutionStore.getState().selectedId,
 theme:appearance=>applyThemeTokens({...DEFAULT_THEME,isDark:appearance==='dark'}),
 view:()=>useWorkViewStore.getState(),
 empty:()=>{useProjectStore.setState({projects:[],activeProjectId:null});useExecutionStore.setState({runs:[]});useLiveSessionStore.setState({sessions:[],runs:[]});useTaskStore.setState({tasks:[]});useManagedTaskStore.setState({queue:{items:[],messages:[],enabledProjects:[],concurrency:4,bridgeUrl:null,bridgeError:null,mergedRunIds:[]}});usePullRequestStore.setState({tracked:{}});useCapacityStore.setState({records:[]});},
 manyRunning:count=>useExecutionStore.setState(state=>({runs:[...state.runs,...Array.from({length:count},(_,i)=>run('extra-'+i,i%2?atlas:orbit,{prompt:'Extra running task '+(i+1),status:'running',startedAt:ago((i+1)*MIN),endedAt:null}))]})),
};
f.theme('light');
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,
 React.createElement('p',{style:{position:'fixed',bottom:0,right:4,zIndex:90,fontSize:10,color:'var(--color-text-secondary)',pointerEvents:'none'}},'Browser fixture only; no native execution'),
 React.createElement(Shell)));
`;

const browser = await chromium.launch({
  channel: process.env.UI_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chrome'),
  headless: true,
});
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
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
    await page.addInitScript(() => localStorage.setItem('jackalope.welcome.seen', '1'));
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
    const theme = async (appearance) => {
      await page.evaluate((value) => window.overviewFixture.theme(value), appearance);
      await page.waitForTimeout(200);
    };
    const shots = async (name) => {
      for (const appearance of ['light', 'dark']) {
        await theme(appearance);
        await page.screenshot({ path: `${output}/${name}-${appearance}-${width}.png` });
      }
      await theme('light');
    };

    // Inbox: the finished conversation is not running, and live work shows its project.
    await page.getByRole('button', { name: 'Inbox', exact: true }).click();
    const rail = page.locator('section[aria-labelledby="inbox-running"]');
    await rail.waitFor();
    const rows = await rail.locator('.live-row').allInnerTexts();
    assert.equal(rows.length, 5, 'the rail lists the first five running items');
    assert.ok(!rows.some((row) => row.includes('Always allow')), 'finished work is not running');
    assert.ok(
      !rows.some((row) => row.includes('refund')),
      'work waiting on an answer is under Needs you',
    );
    assert.ok(
      rows.some((row) => row.includes('Atlas')),
      'rows name their project',
    );
    assert.equal(await rail.locator('.inbox-count').innerText(), '6');
    await rail.getByRole('button', { name: /1 more running/ }).waitFor();
    if (width >= 1280) {
      const top = (selector) =>
        page.locator(selector).evaluate((node) => node.getBoundingClientRect().top);
      assert.equal(await top('#inbox-needs'), await top('#inbox-alerts'), 'rail headings line up');
      assert.equal(
        await top('.inbox-decisions'),
        await top('section[aria-labelledby="inbox-alerts"] .inbox-panel'),
        'rail cards start with the decisions',
      );
    }
    const pill = await rail
      .locator('.inbox-count')
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    const behind = await rail.evaluate((node) => getComputedStyle(node).backgroundColor);
    assert.notEqual(pill, behind, 'the count pill stands out from what is behind it');
    await shots('inbox');
    await rail.scrollIntoViewIfNeeded();
    await shots('inbox-running');

    // Overflow points at Overview.
    await rail.getByRole('button', { name: /more running/ }).click();
    await page.getByRole('heading', { level: 1, name: 'Overview' }).waitFor();
    await page.getByRole('button', { name: 'Inbox', exact: true }).click();
    await rail.waitFor();

    // The keyboard shortcut opens Overview from anywhere.
    await page.keyboard.press(`${mod}+Shift+O`);
    await page.getByRole('heading', { level: 1, name: 'Overview' }).waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Overview', exact: true })
        .getAttribute('aria-current'),
      'page',
    );
    const running = page.locator('section[aria-labelledby="overview-running"]');
    const live = await running.locator('.live-row').allInnerTexts();
    assert.ok(!live.some((row) => row.includes('Always allow')), 'Overview agrees with Inbox');
    assert.ok(live[0].includes('Add a refund approval step'), 'work waiting on you leads');
    assert.ok(live[0].includes('Waiting on you'));
    assert.ok(
      live.some((row) => row.includes('Agent review')),
      'agent reviews are listed',
    );
    assert.ok(
      live.some((row) => row.includes('Checking result')),
      'checks are listed',
    );
    assert.ok(
      live.some((row) => row.includes('Planned task · 2 workers')),
      'a planned task shows its busy workers',
    );
    assert.ok(
      live.some((row) => row.includes('Nightly dependency audit')),
      'scheduled runs name their schedule',
    );
    assert.ok(
      live.some((row) => row.includes('gpt-5.2-codex')),
      'rows show the model',
    );

    const cards = page.locator('.overview-project');
    assert.deepEqual(
      await cards.locator('.overview-project-name').allInnerTexts(),
      ['Orbit', 'Atlas', 'perm-trial'],
      'projects that need you come first',
    );
    const orbit = await cards.first().innerText();
    assert.match(orbit, /#41 PR checks failed · Build, Lint/);
    assert.match(orbit, /#42 PR checks running · 2 of 6 checks running/);
    assert.match(orbit, /Checks failed · pnpm test/);
    assert.match(orbit, /develop/);
    const atlas = await cards.nth(1).innerText();
    assert.match(atlas, /Preview on port 61234/);
    assert.match(atlas, /2 drafts/);
    assert.match(orbit, /3 need you/);
    assert.match(await cards.nth(2).innerText(), /Nothing open/);
    const usage = await page.locator('.overview-usage').innerText();
    assert.match(usage, /Codex/);
    assert.match(usage, /Limit reached/);
    assert.match(usage, /12% remaining/);
    const finished = await page.locator('.overview-finished').innerText();
    assert.match(finished, /Fix the dark mode toggle flicker\s*Merged · Atlas/);
    await shots('overview');
    await page.locator('section[aria-labelledby="overview-projects"]').scrollIntoViewIfNeeded();
    await shots('overview-projects');
    if (width < 1280) {
      await page.locator('section[aria-labelledby="overview-usage"]').scrollIntoViewIfNeeded();
      await shots('overview-usage');
    }
    await page.locator('.overview-page').evaluate((node) => node.scrollTo(0, 0));

    // Keyboard: the page's action leads, then the running rows in order.
    await page.getByRole('button', { name: 'New work' }).last().focus();
    await page.keyboard.press('Tab');
    assert.match(
      await page.evaluate(() => document.activeElement?.textContent ?? ''),
      /Add a refund approval step/,
    );
    assert.notEqual(
      await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle),
      'none',
      'focus is visible',
    );
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.overviewFixture.selected() === 'refunds');

    // A new person without projects gets a start, not an empty dashboard.
    await page.evaluate(() => window.overviewFixture.empty());
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByRole('heading', { name: 'Add a project to get started' }).waitFor();
    await shots('overview-empty');

    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(`Overview checks passed; screenshots in ${output}`);
} finally {
  await browser.close();
}
