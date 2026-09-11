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
import { applyThemeTokens, DEFAULT_THEME } from '/node_modules/@jackalope/brand/src/theme.ts';
import '/src/index.css';
import '/src/components/tasks/task-workspace.css';
import '/src/components/tasks/core-workflow.css';
import '/src/components/ui/experience.css';
const run = {id:'run',taskId:'run',liveSessionId:'session',projectId:'atlas',projectName:'Atlas',projectPath:'C:/Projects/atlas',workspace:'C:/Projects/atlas-session',branch:'session/search',targetBranch:'main',baseHead:'base',agent:'codex',account:'Personal',model:'Example',prompt:'Improve search',status:'running',startedAt:'2026-09-11T12:00:00Z',endedAt:null,sessionId:'provider-session',result:'',activity:[],diagnostics:[],prompts:[],error:null,persistenceError:null,exitCode:null,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,reported:false}};
const session = {id:'session',title:'Search walkthrough',request:{projectId:'atlas',projectName:'Atlas',projectPath:run.projectPath,agent:'codex'},createdAt:run.startedAt,updatedAt:run.startedAt,paused:false,closed:false,pinned:false,draft:{text:'',revision:0},error:null,messages:[{id:'first',text:'The search results need more room.',createdAt:run.startedAt,runId:'run',canceled:false}],batches:[{runId:'run',messageIds:['first'],previousRunId:null,error:null,settled:false}]};
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
 case 'task_preview_status': return null;
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
  page.setDefaultTimeout(15000);
  await page.route('**/src/main.tsx*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fixture }),
  );
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('heading', { name: 'Search walkthrough' }).waitFor();
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
  await page.getByText('1 file · Checks passed').waitFor();
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
  const feedback = page.getByRole('textbox', { name: 'What should change?', exact: true });
  await feedback.fill('Make the Save action clearer.');
  await page.getByRole('button', { name: 'Add to follow-up', exact: true }).click();
  await page.getByText('This would exceed the message limit.', { exact: false }).first().waitFor();
  assert.equal(await feedback.inputValue(), 'Make the Save action clearer.');
  assert.equal((await input.inputValue()).length, 11990);
  await input.fill('Keep the keyboard shortcuts.');
  await page.getByRole('button', { name: 'Add to follow-up', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#preview-feedback').value === '');
  assert.match(
    await input.inputValue(),
    /Keep the keyboard shortcuts[\s\S]*Make the Save action clearer/,
  );
  await page.goto(`${url}/?compact`, { waitUntil: 'domcontentloaded' });
  await page.setViewportSize({ width: 440, height: 620 });
  const pin = page.getByRole('button', { name: 'Always on top', exact: true });
  await pin.click();
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
  assert.equal(await input.inputValue(), '');
  await input.fill('A separate draft');
  await history
    .getByRole('button', { name: 'Make search results easier to scan.', exact: false })
    .click();
  assert.equal(await input.inputValue(), 'And keep keyboard focus in the search box.');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  assert.equal(await input.inputValue(), 'A separate draft');
  await page.setViewportSize({ width: 960, height: 640 });
  await page.evaluate(() => window.sessionFixture.theme('light'));
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('h1')).color === 'rgb(30, 30, 36)',
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
  assert.deepEqual(errors, []);
  console.log(
    `Live-session browser checks passed. Screenshots: ${output}. Browser fixtures only; no native tasks launched.`,
  );
} finally {
  await browser.close();
}
