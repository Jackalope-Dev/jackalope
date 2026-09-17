import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5198';
const output = 'output/playwright/live-session';
await mkdir(output, { recursive: true });
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import { LiveSessionView } from '/src/components/sessions/LiveSessionView.tsx';
import { LiveSessions } from '/src/components/sessions/LiveSessions.tsx';
import { WORKSPACE_VIEWS } from '/src/components/layout/navigation.ts';
import { useLiveSessionStore } from '/src/stores/liveSessionStore.ts';
import { useProjectStore } from '/src/stores/projectStore.ts';
import { applyThemeTokens, DEFAULT_THEME } from '/node_modules/@jackalope/brand/src/theme.ts';
import '/src/index.css';
import '/src/components/tasks/task-workspace.css';
import '/src/components/tasks/core-workflow.css';
import '/src/components/ui/experience.css';
const run = {id:'run',taskId:'run',liveSessionId:'session',projectId:'atlas',projectName:'Atlas',projectPath:'C:/Projects/atlas',workspace:'C:/Projects/atlas-session',branch:'session/search',targetBranch:'main',baseHead:'base',agent:'codex',account:'Personal',model:'Example',prompt:'Improve search',status:'running',startedAt:'2026-09-11T12:00:00Z',endedAt:null,sessionId:'provider-session',result:'',activity:[],diagnostics:[],prompts:[],error:null,persistenceError:null,exitCode:null,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,reported:false}};
const session = {id:'session',title:'Search walkthrough',request:{projectId:'atlas',projectName:'Atlas',projectPath:run.projectPath,agent:'codex'},createdAt:run.startedAt,updatedAt:run.startedAt,paused:false,closed:false,pinned:false,draft:{text:'',revision:0},error:null,messages:[{id:'first',text:'The search results need more room.',createdAt:run.startedAt,runId:'run',canceled:false}],batches:[{runId:'run',messageIds:['first'],previousRunId:null,error:null,settled:false}]};
const project = {id:'atlas',name:'Atlas',path:run.projectPath,gitBranch:'main'};
useProjectStore.setState({projects:[project],selectedProjectId:'atlas'});
const patch = 'diff --git a/src/search.tsx b/src/search.tsx\\n--- a/src/search.tsx\\n+++ b/src/search.tsx\\n@@ -1 +1 @@\\n-narrow\\n+roomy\\n';
let plan = null;
let rating = null;
let seen = false;
const f = window.sessionFixture = {
 calls:[], failSend:false, holdSend:false, failPin:false, failCreate:false, holdCreate:false, release:null,
 navigation: WORKSPACE_VIEWS,
 theme: appearance => applyThemeTokens({...DEFAULT_THEME,isDark:appearance==='dark'}),
 update: changes => useLiveSessionStore.setState(s=>({sessions:s.sessions.map(item=>({...item,...changes}))})),
 run: changes => useLiveSessionStore.setState(s=>({runs:s.runs.map(item=>({...item,...changes}))})),
};
window.__TAURI_INTERNALS__ = { transformCallback:()=>0, metadata:{currentWindow:{label:'live-session-session'}}, invoke: async (command,args={}) => {
 f.calls.push({command,...args});
 const s = useLiveSessionStore.getState().sessions[0];
 switch(command) {
 case 'live_session_snapshot': return {sessions:useLiveSessionStore.getState().sessions,runs:useLiveSessionStore.getState().runs,error:null};
 case 'knowledge_list': return [];
 case 'knowledge_preview': return {entries:[],bytes:0,reasons:{}};
 case 'queue_snapshot': return f.managedQueue ?? {items:[],managedTasks:[],messages:[],enabledProjects:[],concurrency:3,bridgeUrl:null,bridgeError:null,mergedRunIds:[]};
 case 'task_strategy_assess': return {id:'fixture-assessment',sourceHead:'base',strategy:'single',parallelAvailable:false,reason:'This fixture continues with one lead.',createdAt:new Date().toISOString(),cached:false,decision:{version:1,kind:'task_strategy',requestedMode:'deterministic',provider:'local_rules',policyRevision:1,modelCallAttempted:false,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,reported:true}}};
 case 'task_strategy_history': return [];
 case 'task_strategy_cancel': return;
 case 'task_usefulness': if(args.useful!==undefined)rating={useful:args.useful,reviewMinutes:args.reviewMinutes};return rating;
 case 'task_review_progress': if(args.seenTree)seen=true;return {tree:'tree',diff:seen?'':patch,files:seen?[]:['src/search.tsx'],viewedAt:seen?'2026-09-16T12:00:00Z':null,note:seen?'Changes since your saved review position.':'All current changes.'};
 case 'integration_plans': return plan?[plan]:[];
 case 'integration_prepare': plan={id:'plan',runIds:args.runIds,projectPath:run.projectPath,targetBranch:'main',status:'ready',files:['src/search.tsx'],masterHead:'baseline',patch,conflicts:[],commitMessage:args.commitMessage||'Improve search',commitPolicy:{attribution:'agent',cleanupAfterMerge:true}};return plan;
 case 'integration_apply': plan={...plan,status:'applied',cleanupResults:[{workspace:run.workspace,removed:true}]};f.update({integratedRunId:'run',closed:true,paused:true});return plan;
 case 'project_github_context': return {title:'Fix search',url:'https://github.com/example/atlas/issues/42',text:'External issue body.',truncated:false};
 case 'live_session_limits': f.update({limits:args.limits});return;
 case 'live_session_create': {
  if(f.failCreate) throw new Error('The session could not be saved.');
  if(f.holdCreate) await new Promise(resolve=>{f.release=resolve});
  const existing=useLiveSessionStore.getState().sessions;
  if(!existing.some(item=>item.id===args.id)) useLiveSessionStore.setState({sessions:[...existing,{...session,id:args.id,title:args.firstMessage.text.trim().split(/\\s+/).join(' ').slice(0,64),request:args.request,messages:[{id:args.firstMessage.id,text:args.firstMessage.text,createdAt:new Date().toISOString(),runId:null,canceled:false}],batches:[]}]});
  return args.id;
 }
 case 'agent_save_policy': case 'plugin:event|listen': case 'plugin:event|unlisten': return 0;
 case 'live_session_draft':
  if(args.revision!==s.draft.revision) throw new Error('The draft changed in another window.');
  const draft={text:args.text,revision:s.draft.revision+1};f.update({draft});return draft;
 case 'live_session_send':
  if(f.holdSend) await new Promise(resolve=>{f.release=resolve});
  if(f.failSend) throw new Error('Could not save this message. Try again.');
  const current=useLiveSessionStore.getState().sessions[0];
  const nextDraft=args.draftRevision===current.draft.revision?{text:'',revision:current.draft.revision+1}:current.draft;
  const messages=current.messages.some(m=>m.id===args.messageId)?current.messages:[...current.messages,{id:args.messageId,text:args.text,createdAt:new Date().toISOString(),runId:null,canceled:false}];
  f.update({messages,draft:nextDraft});return nextDraft;
 case 'live_session_window_pin': if(f.failPin)throw new Error('Pin could not be saved.');f.update({pinned:args.pinned});return;
 case 'live_session_window': return;
 case 'live_session_action':
  if(args.action==='cancel-message')f.update({messages:s.messages.map(m=>m.id===args.messageId?{...m,canceled:true}:m)});
  else f.update({paused:args.action!=='resume',closed:args.action==='finish'});
  return;
 case 'live_session_review': return {files:['src/search.tsx'],diff:'diff --git a/src/search.tsx b/src/search.tsx\\n--- a/src/search.tsx\\n+++ b/src/search.tsx\\n@@ -1 +1 @@\\n-narrow\\n+roomy\\n',note:'',patchPath:'C:/Exports/session.patch',tree:'tree',verified:true};
 case 'task_respond_prompt': f.run({prompts:[]});return true;
 case 'task_stop':
  if(f.failStop)throw new Error('Could not stop this attempt.');
  f.run({status:'stopping'});
  if(f.holdStop)await new Promise(resolve=>{f.releaseStop=resolve});
  f.run({status:'stopped'});f.update({batches:s.batches.map(batch=>({...batch,settled:true}))});return;
 case 'task_preview_status': return f.preview ?? null;
 case 'task_preview_start': f.preview={port:5418,command:args.command,running:true,ready:true,output:'Ready',exitCode:null};return f.preview;
 case 'task_preview_inspect': return {screenshot:{id:'capture',name:'Preview capture',timestamp:new Date().toISOString(),filePath:'C:/preview.png',url:'http://localhost:5418/',mimeType:'image/png'},snapshot:'button Save [ref=save]',errors:''};
 case 'task_screenshot': return Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2WQAAAAASUVORK5CYII='), c=>c.charCodeAt(0));
 case 'task_preview_inspect_cancel': return;

 case 'plugin:window|minimize': case 'plugin:window|close': return;
 default: throw new Error('Unexpected fixture command: '+command);
 }
}};
const hub=location.search.includes('hub');
useLiveSessionStore.setState({sessions:hub?[]:[session],runs:hub?[]:[run],selectedId:hub?null:'session',loading:false,refresh:async()=>{}});
f.history=()=>useLiveSessionStore.setState(s=>({sessions:[...s.sessions,
 {...session,id:'finished',title:'Finished walkthrough',closed:true,batches:[]},
 {...session,id:'old',title:'Earlier session',updatedAt:'2026-09-10T12:00:00Z',messages:[],batches:[]},
 {...session,id:'review',title:'Review new results',messages:[],batches:[{runId:'review-run',messageIds:[],settled:true}]},
 {...session,id:'attention',title:'Resolve a failed check',error:'Checks failed',batches:[]},
 session],runs:[run,{...run,id:'review-run',status:'review',endedAt:'2026-09-12T12:00:00Z'}]}));
f.theme('dark');
function Example(){const {sessions,runs}=useLiveSessionStore();return React.createElement('main',{style:{height:'100vh',display:'flex',flexDirection:'column'}},React.createElement('p',{style:{fontSize:11,padding:'4px 14px',color:'var(--color-text-muted)'}},'Browser fixture only; no native tasks launched.'),hub?React.createElement(LiveSessions,{project:{id:'atlas',name:'Atlas',path:run.projectPath,gitBranch:'main'},onOpenProject:()=>{}}):React.createElement(LiveSessionView,{session:sessions[0],runs,detached:location.search.includes('compact'),onBack:()=>{}}));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Example));
`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /same key|In HTML|cannot contain a nested/.test(message.text())
    )
      errors.push(message.text());
  });
  page.setDefaultTimeout(15000);
  await page.route('**/src/main.tsx*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fixture }),
  );
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('heading', { name: 'Search walkthrough' }).waitFor();
  await page.getByRole('button', { name: 'Chat options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Session limits', exact: true }).click();
  await page.getByLabel('Pause after this many batches').fill('8');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  await page.getByText('Limits saved.', { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () =>
        window.sessionFixture.calls.find((call) => call.command === 'live_session_limits').limits
          .maxBatches,
    ),
    8,
  );
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Chat options',
  );
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Keep the result titles on one line.');
  await page.evaluate(() => {
    window.sessionFixture.failSend = true;
  });
  await input.press('Enter');
  await page.getByText('Could not save this message. Try again.', { exact: false }).waitFor();
  assert.equal(await input.inputValue(), 'Keep the result titles on one line.');
  await page.evaluate(() => {
    window.sessionFixture.failSend = false;
  });
  await input.press('Enter');
  await page.waitForFunction(() => document.querySelector('textarea').value === '');
  const sends = await page.evaluate(() =>
    window.sessionFixture.calls.filter((c) => c.command === 'live_session_send'),
  );
  assert.equal(sends[0].messageId, sends[1].messageId);
  assert.equal(
    await page
      .locator('.live-message')
      .filter({ hasText: 'Keep the result titles on one line.' })
      .count(),
    1,
  );
  await page.evaluate(() => {
    window.sessionFixture.holdSend = true;
  });
  await input.fill('Let Escape close search.');
  await input.press('Enter');
  await page.waitForFunction(() => !!window.sessionFixture.release);
  await input.fill('And restore focus to the search button.');
  await page.evaluate(() => {
    window.sessionFixture.holdSend = false;
    window.sessionFixture.release();
  });
  await page.getByRole('button', { name: 'Queue message', exact: true }).waitFor();
  await page.waitForFunction(() =>
    window.sessionFixture.calls.some(
      (c) =>
        c.command === 'live_session_draft' && c.text === 'And restore focus to the search button.',
    ),
  );
  assert.equal(await input.inputValue(), 'And restore focus to the search button.');
  await input.press('Enter');
  await page.waitForFunction(() => document.querySelector('textarea').value === '');
  await input.fill('First line');
  await input.press('Shift+Enter');
  await input.pressSequentially('Second line');
  assert.equal(await input.inputValue(), 'First line\nSecond line');
  await input.fill('');
  await page.getByRole('button', { name: 'Cancel queued message' }).first().click();
  await page.locator('.live-message[data-canceled=true]').first().waitFor();
  assert.equal(await page.locator('.live-message[data-canceled=true]').count(), 1);
  await page.getByRole('button', { name: 'Pause queue', exact: true }).click();
  await page.getByRole('button', { name: 'Resume queue', exact: true }).waitFor();
  assert.equal(await input.isEnabled(), true);
  await page.screenshot({ path: `${output}/session-1280-dark.png` });
  await page.setViewportSize({ width: 960, height: 640 });
  await page.evaluate(() => window.sessionFixture.theme('light'));
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('h1')).color === 'rgb(30, 30, 36)',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({ path: `${output}/session-960-light.png` });
  await page.evaluate(() =>
    window.sessionFixture.run({
      status: 'review',
      result:
        'Search now keeps each title on one line. Escape closes the panel and restores focus.\n\nChecked keyboard navigation and the focused search tests.',
    }),
  );
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('navigation', { name: 'Changed files', exact: true }).waitFor();
  const calls = await page.evaluate(() => window.sessionFixture.calls.map((c) => c.command));
  assert.ok(calls.lastIndexOf('live_session_action') < calls.lastIndexOf('live_session_review'));
  await page.evaluate(() => window.sessionFixture.run({ verificationError: 'Check failed' }));
  await page
    .locator('.live-message')
    .filter({ hasText: 'The search results need more room.' })
    .getByText('Needs attention', { exact: true })
    .waitFor();
  await page.evaluate(async () => {
    const { useLiveSessionStore } = await import('/src/stores/liveSessionStore.ts');
    const s = useLiveSessionStore.getState().sessions[0];
    useLiveSessionStore.setState({
      runs: [],
      sessions: [{ ...s, paused: false, messages: [s.messages[0]] }],
    });
  });
  await page.getByRole('button', { name: '1 queued', exact: true }).waitFor();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await input.fill('Use the simpler search layout.');
  await page.evaluate(() => {
    window.sessionFixture.holdStop = true;
  });
  await page.getByRole('button', { name: 'Stop and send', exact: true }).click();
  await page.waitForFunction(() => !!window.sessionFixture.releaseStop);
  assert.equal(
    await page.evaluate(() =>
      window.sessionFixture.calls.some((call) => call.command === 'live_session_send'),
    ),
    false,
  );
  await page.evaluate(() => window.sessionFixture.releaseStop());
  await page.waitForFunction(() => document.querySelector('textarea').value === '');
  await page.waitForFunction(() =>
    window.sessionFixture.calls.some(
      (call) => call.command === 'live_session_action' && call.action === 'resume',
    ),
  );
  assert.deepEqual(
    await page.evaluate(() =>
      window.sessionFixture.calls
        .filter((call) =>
          ['task_stop', 'live_session_send', 'live_session_action'].includes(call.command),
        )
        .map((call) => call.action || call.command),
    ),
    ['pause', 'task_stop', 'live_session_send', 'resume'],
  );
  await page.evaluate(() => {
    window.sessionFixture.run({ status: 'running' });
    window.sessionFixture.failStop = true;
  });
  await input.fill('Preserve this if stopping fails.');
  await page.getByRole('button', { name: 'Stop and send', exact: true }).click();
  await page.getByText('Could not stop this attempt.', { exact: false }).waitFor();
  assert.equal(await input.inputValue(), 'Preserve this if stopping fails.');
  await page.evaluate(() => window.sessionFixture.run({ status: 'review' }));
  await input.fill('x'.repeat(11990));
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  assert.equal(
    await page.getByRole('textbox', { name: 'What should change?', exact: true }).count(),
    0,
  );
  await page.getByText('Add a preview command below, or detect one from the project.').waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Start preview', exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await page.getByText('Stop preview before continuing or merging.', { exact: false }).count(),
    0,
  );
  await page.getByLabel('Preview command', { exact: true }).fill('node app.mjs --port {port}');
  await page.getByRole('button', { name: 'Start preview', exact: true }).click();
  await page.getByRole('button', { name: 'Capture evidence', exact: true }).click();
  await page.getByRole('button', { name: 'Add evidence to follow-up', exact: true }).click();
  await page.getByText('This would exceed the message limit.', { exact: false }).first().waitFor();
  assert.equal((await input.inputValue()).length, 11990);
  await input.fill('Keep the keyboard shortcuts.');
  await page.getByRole('button', { name: 'Add evidence to follow-up', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('textarea').value.includes('Preview evidence'),
  );
  assert.match(await input.inputValue(), /Keep the keyboard shortcuts[\s\S]*Preview evidence/);
  await page.goto(`${url}/?compact`, { waitUntil: 'domcontentloaded' });
  await page.setViewportSize({ width: 440, height: 620 });
  const pin = page.getByRole('button', { name: 'Always on top', exact: true });
  await pin.click();
  await page.waitForFunction(
    () =>
      document.querySelector('button[aria-label="Always on top"]')?.getAttribute('aria-pressed') ===
      'true',
  );
  assert.equal(await pin.getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => {
    window.sessionFixture.failPin = true;
  });
  await pin.click();
  await page.getByText('Pin could not be saved.', { exact: false }).waitFor();
  assert.equal(await pin.getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => {
    window.sessionFixture.failPin = false;
  });
  await pin.click();
  await page.screenshot({ path: `${output}/window-440-dark.png` });
  await page.getByRole('button', { name: 'Collapse conversation' }).click();
  assert.equal(await page.locator('.live-transcript').count(), 0);
  await input.fill('A compact thought');
  await input.press('Enter');
  await page.getByRole('button', { name: 'Expand conversation' }).click();
  await page.getByText('A compact thought', { exact: true }).waitFor();
  await page.setViewportSize({ width: 320, height: 320 });
  await page.evaluate(() => window.sessionFixture.theme('light'));
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('h1')).color === 'rgb(30, 30, 36)',
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.screenshot({ path: `${output}/window-320-light.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const inputBox = await input.boundingBox();
  assert.ok(inputBox.y + inputBox.height <= 320);
  await pin.focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(() => document.activeElement.getAttribute('aria-label')),
    'Return to main window',
  );
  await page.getByRole('button', { name: 'Close window', exact: true }).click();
  await page.waitForFunction(() =>
    window.sessionFixture.calls.some((c) => c.command === 'plugin:window|close'),
  );
  const closeCalls = await page.evaluate(() => window.sessionFixture.calls);
  assert.ok(closeCalls.some((c) => c.command === 'plugin:window|close'));
  assert.ok(!closeCalls.some((c) => c.command === 'task_stop'));
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.goto(`${url}/?hub`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Atlas', exact: true }).waitFor();
  assert.ok(
    await page.evaluate(() =>
      window.sessionFixture.navigation.some(
        (view) =>
          view.id === 'live-sessions' &&
          view.label === 'Tasks' &&
          view.group === 'tasks' &&
          view.primary === true,
      ),
    ),
  );
  assert.equal(await page.getByRole('textbox').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'New chat', exact: true }).count(), 0);
  assert.ok(await input.evaluate((element) => element === document.activeElement));
  await page.screenshot({ path: `${output}/hub-start-1280-dark.png` });
  await input.fill('Make search results easier to scan.');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await input.waitFor();
  assert.equal(await input.inputValue(), 'Make search results easier to scan.');
  await page.evaluate(() => {
    window.sessionFixture.failCreate = true;
  });
  await input.press('Enter');
  await page.getByText('The session could not be saved.', { exact: false }).waitFor();
  assert.equal(await input.inputValue(), 'Make search results easier to scan.');
  await page.evaluate(() => {
    window.sessionFixture.failCreate = false;
    window.sessionFixture.holdCreate = true;
  });
  await input.press('Enter');
  await page.waitForFunction(() => !!window.sessionFixture.release);
  await input.fill('And keep keyboard focus in the search box.');
  await page.evaluate(() => {
    window.sessionFixture.holdCreate = false;
    window.sessionFixture.release();
  });
  await page
    .getByRole('heading', { name: 'Make search results easier to scan.', exact: true })
    .waitFor();
  assert.equal(await input.inputValue(), 'And keep keyboard focus in the search box.');
  const creates = await page.evaluate(() =>
    window.sessionFixture.calls.filter((call) => call.command === 'live_session_create'),
  );
  assert.equal(creates.length, 2);
  assert.equal(creates[0].id, creates[1].id);
  assert.equal(creates[0].firstMessage.id, creates[1].firstMessage.id);
  assert.equal(creates[1].firstMessage.text, 'Make search results easier to scan.');
  assert.equal(creates[1].title, undefined);
  assert.equal(await page.locator('.live-message').count(), 1);
  await page.evaluate(() => window.sessionFixture.history());
  const history = page.getByRole('navigation', { name: 'Chats', exact: true });
  await history.getByRole('heading', { name: 'Finished', exact: true }).waitFor();
  assert.deepEqual(await history.getByRole('heading').allTextContents(), [
    'Needs attention',
    'In progress',
    'Recent',
    'Finished',
  ]);
  const titles = await history.locator('strong').allTextContents();
  assert.equal(titles[0], 'Resolve a failed check');
  assert.ok(titles.indexOf('Review new results') < titles.indexOf('Earlier session'));
  assert.equal(titles.at(-1), 'Finished walkthrough');
  await page.screenshot({ path: `${output}/hub-1280-dark.png` });
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const daily = page.getByRole('region', { name: 'Work across all projects', exact: true });
  assert.equal(await daily.getByText('No loaded work is waiting for your review.').count(), 0);
  for (const button of [
    daily.getByRole('button', { name: 'All projects', exact: true }),
    daily.getByRole('button', { name: /in progress/ }),
  ]) {
    assert.notEqual(
      await button.evaluate((el) => getComputedStyle(el).backgroundColor),
      'rgba(0, 0, 0, 0)',
    );
  }
  await page.evaluate(async () => {
    const { useManagedTaskStore } = await import('/src/stores/managedTaskStore.ts');
    const { useExecutionStore } = await import('/src/stores/executionStore.ts');
    const run = {
      ...(await import('/src/stores/liveSessionStore.ts')).useLiveSessionStore.getState().runs[0],
      id: 'working-run',
      taskId: 'working-run',
      projectId: 'atlas',
      status: 'running',
      liveSessionId: null,
    };
    const queue = {
      ...useManagedTaskStore.getState().queue,
      managedTasks: [
        {
          id: 'working-task',
          title: 'Implement search controls',
          request: { projectId: 'atlas', agent: 'codex' },
          plannerRunId: 'planner',
          runIds: [run.id],
          started: true,
          error: null,
        },
      ],
      items: [],
      enabledProjects: ['managed:working-task'],
    };
    window.sessionFixture.managedQueue = queue;
    useExecutionStore.setState({ runs: [run] });
    useManagedTaskStore.setState({ queue });
  });
  const working = history.getByRole('button', {
    name: 'Implement search controls Working',
    exact: true,
  });
  const character = working.locator('.brand-agent-character');
  await character.waitFor();
  assert.equal(await character.getAttribute('data-state'), 'working');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.notEqual(await character.evaluate((el) => getComputedStyle(el).animationName), 'none');
  await page.screenshot({ path: `${output}/hub-active-controls-dark.png` });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await character.evaluate((el) => getComputedStyle(el).animationName), 'none');
  await page.evaluate(() => window.sessionFixture.theme('light'));
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.brand-agent-character, .daily-work-row')].every(
      (element) => getComputedStyle(element).color === 'rgb(30, 30, 36)',
    ),
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.screenshot({ path: `${output}/hub-active-controls-light.png` });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(async () => {
    const { useManagedTaskStore } = await import('/src/stores/managedTaskStore.ts');
    const queue = { ...useManagedTaskStore.getState().queue, managedTasks: [] };
    window.sessionFixture.managedQueue = queue;
    useManagedTaskStore.setState({ queue });
    (await import('/src/stores/executionStore.ts')).useExecutionStore.setState({ runs: [] });
    window.sessionFixture.theme('dark');
  });

  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  assert.equal(await input.inputValue(), '');
  await input.fill('A separate draft');
  await history
    .getByRole('button', { name: 'Make search results easier to scan.', exact: false })
    .click();
  assert.equal(await input.inputValue(), 'And keep keyboard focus in the search box.');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  assert.equal(await input.inputValue(), 'A separate draft');
  assert.equal(await page.getByText('Session limits', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Chat options', exact: true }).click();
  await page
    .getByRole('menuitem', { name: 'Start from a repeatable workflow', exact: true })
    .click();
  await page.getByLabel('Issue number', { exact: true }).fill('42');
  await page.getByRole('button', { name: 'Prepare task draft' }).click();
  await page.waitForFunction(() =>
    document.querySelector('textarea').value.includes('External issue body.'),
  );
  assert.ok((await input.inputValue()).startsWith('A separate draft'));
  assert.ok((await input.inputValue()).includes("user's explicit authorization"));
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await input.evaluate((node) => node === document.activeElement), true);
  await page.getByRole('button', { name: 'Chat options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Session limits', exact: true }).click();
  await page.getByLabel('Pause after this many batches').fill('3');
  await page.getByLabel('Pause at estimated cost (USD)', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Save limits' }).click();
  await page.getByText('Limits saved.', { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/chat-limits-dark.png` });
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('jackalope-live-start:atlas:limits')),
    ),
    { maxBatches: 3, pauseAtEstimatedUsd: 5 },
  );
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Chat options', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Session limits', exact: true }).press('Enter');
  assert.equal(await page.getByLabel('Pause after this many batches').inputValue(), '3');
  assert.equal(
    await page.getByLabel('Pause at estimated cost (USD)', { exact: true }).inputValue(),
    '5',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const preservedDraft = await input.inputValue();
  await page.getByRole('button', { name: 'Chat options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Saved project context', exact: true }).click();
  const memory = page.getByRole('checkbox', { name: 'Use matching project lessons (up to three)' });
  await memory.uncheck();
  await page.screenshot({ path: `${output}/chat-context-dark.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await input.inputValue(), preservedDraft);
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('jackalope-live-start:atlas:context')).memoryOff,
    ),
    true,
  );
  await page.getByRole('button', { name: 'Chat options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Saved project context', exact: true }).click();
  assert.equal(await memory.isChecked(), false);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('region', { name: 'Work across all projects' }).waitFor();
  await page.setViewportSize({ width: 960, height: 640 });
  await page.evaluate(() => window.sessionFixture.theme('light'));
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.live-start h2')).color === 'rgb(30, 30, 36)',
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.screenshot({ path: `${output}/hub-960-light.png` });
  await page.setViewportSize({ width: 640, height: 700 });
  await page.screenshot({ path: `${output}/hub-640-light.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const startBox = await input.boundingBox();
  assert.ok(startBox.y + startBox.height <= 700);
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    window.sessionFixture.run({ status: 'review', endedAt: '2026-09-16T12:00:00Z' });
    window.sessionFixture.update({
      paused: true,
      batches: [{ runId: 'run', messageIds: ['first'], settled: true }],
    });
  });
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByText('More review tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Changes since my last review' }).click();
  await page.getByText('All current changes.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Mark these changes seen' }).click();
  await page.getByText('No changes since this review position.', { exact: true }).waitFor();
  await page.getByText('Track result usefulness', { exact: true }).click();
  await page.getByLabel('Minutes spent reviewing and correcting (optional)').fill('4');
  await page.getByRole('button', { name: 'Useful result', exact: true }).click();
  await page.getByText('Your rating is saved.', { exact: true }).waitFor();
  await page.getByText('Track result usefulness', { exact: true }).click();
  await page.getByRole('button', { name: 'Preview merge into main', exact: true }).click();
  await page.getByRole('button', { name: 'Merge into main and clean up', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/review-1280-dark.png` });
  await page.getByRole('button', { name: 'Merge into main and clean up', exact: true }).click();
  await page.getByText('Integrated into main', { exact: true }).waitFor();
  assert.equal(await input.isDisabled(), true);
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await page.getByRole('button', { name: 'Continue in a new chat', exact: true }).click();
  assert.ok(
    await page.evaluate(() =>
      localStorage.getItem('jackalope-live-start:atlas').includes('A separate draft'),
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    `Live-session browser checks passed. Screenshots: ${output}. Browser fixtures only; no native tasks launched.`,
  );
} finally {
  await browser.close();
}
