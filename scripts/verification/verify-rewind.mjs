import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Browser fixture for "Edit from here" in a conversation: fake IPC, no native tasks launched,
// no files restored and no provider conversation changed.
const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5173';
const output = 'output/playwright/rewind';
await mkdir(output, { recursive: true });
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import { LiveSessionView } from '/src/components/sessions/LiveSessionView.tsx';
import { useLiveSessionStore } from '/src/stores/liveSessionStore.ts';
import { useProjectStore } from '/src/stores/projectStore.ts';
import { applyThemeTokens, DEFAULT_THEME } from '/node_modules/@jackalope/brand/src/theme.ts';
import '/src/index.css';
import '/src/components/tasks/task-workspace.css';
import '/src/components/tasks/core-workflow.css';
const texts = ['Add a search box to the header.', 'Make the results a grid.', 'Use three columns.'];
const turn = (index, adapter) => ({
 id:'run-'+index, taskId:'run-1', liveSessionId:'session', projectId:'atlas', projectName:'Atlas',
 projectPath:'/Projects/atlas', workspace:'/Projects/atlas/.worktrees/search', branch:'jackalope/search',
 targetBranch:'main', baseHead:'base', agent:adapter, account:'Work', model:null,
 accountBinding:{adapter, profileId:null, directory:'/accounts', label:'Work'},
 prompt:'Live session batch '+index, status:'review',
 startedAt:'2026-11-24T10:0'+index+':00Z', endedAt:'2026-11-24T10:0'+index+':30Z',
 sessionId:'provider-session', result:'Done with step '+index+'.', activity:[], diagnostics:[], prompts:[],
 error:null, persistenceError:null, exitCode:0,
 usage:{input:0,output:0,cacheRead:0,cacheWrite:0,reported:false},
 rewind:{checkpoint:{reference:'refs/jackalope/checkpoints/run-1/run-'+index,commit:'c'+index,head:'h',tree:'t'+index}, mark:{session:'provider-session', entry:'entry-'+index}},
});
const runs = adapter => [1,2,3].map(index => turn(index, adapter));
const session = {id:'session', title:'Search header', request:{projectId:'atlas', projectName:'Atlas', projectPath:'/Projects/atlas', agent:'claude'},
 createdAt:'2026-11-24T10:00:00Z', updatedAt:'2026-11-24T10:03:30Z', paused:false, closed:false, pinned:false,
 draft:{text:'', revision:0}, error:null,
 messages:texts.map((text, index) => ({id:'m'+(index+1), text, createdAt:'2026-11-24T10:0'+(index+1)+':00Z', runId:'run-'+(index+1), canceled:false})),
 batches:[1,2,3].map(index => ({runId:'run-'+index, messageIds:['m'+index], previousRunId:index>1?'run-'+(index-1):null, error:null, settled:true}))};
useProjectStore.setState({projects:[{id:'atlas', name:'Atlas', path:'/Projects/atlas', gitBranch:'main'}], selectedProjectId:'atlas'});
const f = window.rewindFixture = {
 calls:[],
 theme: appearance => applyThemeTokens({...DEFAULT_THEME, isDark:appearance==='dark'}),
 scenario: adapter => useLiveSessionStore.setState({sessions:[session], runs:runs(adapter)}),
 run: (id, changes) => useLiveSessionStore.setState(s => ({runs:s.runs.map(run => run.id===id ? {...run, ...changes} : run)})),
 update: changes => useLiveSessionStore.setState(s => ({sessions:s.sessions.map(item => ({...item, ...changes}))})),
};
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
window.__TAURI_INTERNALS__ = { transformCallback:()=>0, metadata:{currentWindow:{label:'main'}, currentWebview:{label:'main'}}, invoke: async (command, args = {}) => {
 f.calls.push({command, ...args});
 const state = useLiveSessionStore.getState();
 const s = state.sessions[0];
 switch(command) {
 case 'live_session_snapshot': return {sessions:state.sessions, runs:state.runs, error:null};
 case 'task_rewind_preview': {
  const index = Number(args.runId.split('-')[1]);
  return {runId:args.runId, latestRunId:'run-3', turn:index, undone:4-index, conversation:index===1?'new':'claude', prompt:'Live session batch '+index};
 }
 case 'task_rewind': {
  const index = Number(args.runId.split('-')[1]);
  const rewound = state.runs.filter(run => Number(run.id.split('-')[1]) >= index).map(run => run.id);
  const rewind = {id:'rewind-1', at:new Date().toISOString(), turnRunId:args.runId, turn:index, rewoundRunIds:rewound,
   restored:{reference:'refs/jackalope/checkpoints/run-1/'+args.runId, commit:'c', head:'h', tree:'t'},
   safety:{reference:'refs/jackalope/rewinds/run-1/rewind-1', commit:'s', head:'h', tree:'s'},
   resume:index===1?{kind:'new'}:{kind:'claude', session:'provider-session', at:'entry-'+(index-1)}};
  useLiveSessionStore.setState({runs:state.runs.map(run => ({...run, rewind:{...run.rewind,
   ...(rewound.includes(run.id) ? {rewound:{rewindId:'rewind-1', at:rewind.at}} : {}),
   ...(run.id==='run-3' ? {applied:rewind} : {})}}))});
  return {rewind, prompt:texts[index-1]};
 }
 case 'task_rewind_undo':
  useLiveSessionStore.setState({runs:state.runs.map(run => ({...run, rewind:{checkpoint:run.rewind.checkpoint, mark:run.rewind.mark}}))});
  return;
 case 'live_session_draft': {
  const draft = {text:args.text, revision:s.draft.revision+1}; f.update({draft}); return draft;
 }
 case 'live_session_action': return;
 case 'task_effort_levels': return [];
 case 'project_files_list': return [];
 case 'knowledge_list': return [];
 case 'queue_snapshot': return {items:[], managedTasks:[], messages:[], enabledProjects:[], concurrency:3, bridgeUrl:null, bridgeError:null, mergedRunIds:[]};
 case 'integration_plans': return [];
 case 'task_preview_status': return null;
 case 'task_followup_snapshot': return [];
 case 'task_usefulness': return null;
 case 'task_change_stats': return {};
 case 'agent_save_policy': case 'plugin:event|listen': case 'plugin:event|unlisten': return 0;
 default: throw new Error('Unexpected fixture command: '+command);
 }
}};
f.scenario('claude');
useLiveSessionStore.setState({selectedId:'session', loading:false, refresh:async()=>{}});
f.theme('dark');
function Example() {
 const {sessions, runs} = useLiveSessionStore();
 return React.createElement('main', {style:{height:'100vh', display:'flex', flexDirection:'column'}},
  React.createElement('p', {style:{fontSize:11, padding:'4px 14px', color:'var(--color-text-muted)'}}, 'Browser fixture only; no native tasks launched.'),
  React.createElement(LiveSessionView, {session:sessions[0], runs, onBack:()=>{}}));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Example));
`;
const channel = process.platform === 'win32' ? 'msedge' : 'chrome';
const browser = await chromium.launch({ channel, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /same key|In HTML|cannot contain a nested/.test(message.text())
    )
      errors.push(message.text());
  });
  await page.route('**/src/main.tsx*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fixture }),
  );
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const transcript = page.locator('.live-transcript');
  await transcript.getByText('Make the results a grid.').waitFor({ timeout: 30000 });
  const edit = transcript.getByRole('button', { name: 'Edit from here' });
  assert.equal(await edit.count(), 3, 'every turn in effect offers Edit from here');

  // Hidden until the message is hovered or focused, like Copy.
  const second = transcript
    .locator('.live-message')
    .filter({ hasText: 'Make the results a grid.' });
  const action = second.getByRole('button', { name: 'Edit from here' });
  assert.equal(await action.evaluate((node) => getComputedStyle(node).opacity), '0');
  await second.hover();
  await page.waitForFunction(
    (node) => getComputedStyle(node).opacity === '1',
    await action.elementHandle(),
  );

  // Keyboard: focus reveals it and Enter opens the confirmation with its preview.
  await page.mouse.move(0, 0);
  await action.focus();
  await page.waitForFunction(
    (node) => getComputedStyle(node).opacity === '1',
    await action.elementHandle(),
  );
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Edit from turn 2?' });
  await dialog.waitFor();
  assert.match(
    await dialog.innerText(),
    /This will undo 2 turns \(turns 2 to 3\) and restore files to how they were after turn 1\. Uncommitted changes made since will be kept in a safety snapshot\./,
  );
  assert.match(await dialog.innerText(), /Claude Code continues from the end of turn 1/);
  await page.screenshot({ path: `${output}/dark-confirm-1280.png` });
  // Escape cancels without rewinding.
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(
    (await page.evaluate(() => window.rewindFixture.calls)).some(
      (c) => c.command === 'task_rewind',
    ),
    false,
  );

  await action.focus();
  await page.keyboard.press('Enter');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Rewind' }).focus();
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'detached' });
  const rewinds = await page.evaluate(() =>
    window.rewindFixture.calls.filter((call) => call.command === 'task_rewind'),
  );
  assert.deepEqual(
    rewinds.map(({ runId, latestRunId }) => ({ runId, latestRunId })),
    [{ runId: 'run-2', latestRunId: 'run-3' }],
  );
  // The turn's message is back in the composer and the undone turns are collapsed.
  const composer = page.getByRole('textbox').last();
  await page.waitForFunction(
    (node) => node.value.includes('Make the results a grid.'),
    await composer.elementHandle(),
  );
  const group = transcript.locator('.rewound-turns');
  await group.getByText('2 rewound turns').waitFor();
  assert.equal(await group.evaluate((node) => node.open), false);
  assert.equal(await transcript.getByText('Use three columns.').isVisible(), false);
  assert.equal(await edit.count(), 1, 'rewound turns offer nothing');
  await group.getByText('2 rewound turns').click();
  await transcript.getByText('Use three columns.').waitFor();
  const notice = page.locator('.rewind-notice');
  assert.match(await notice.innerText(), /Rewound to turn 2: 2 turns are undone/);
  assert.match(await notice.innerText(), /refs\/jackalope\/rewinds\/run-1\/rewind-1/);
  await page.screenshot({ path: `${output}/dark-rewound-1280.png` });

  // Undo brings the turns back.
  await notice.getByRole('button', { name: 'Undo rewind' }).click();
  await notice.waitFor({ state: 'detached' });
  assert.equal(await transcript.locator('.rewound-turns').count(), 0);
  const undos = await page.evaluate(() =>
    window.rewindFixture.calls.filter((call) => call.command === 'task_rewind_undo'),
  );
  assert.deepEqual(
    undos.map(({ runId }) => runId),
    ['run-3'],
  );

  // A running turn disables the others and explains why.
  await page.evaluate(() => window.rewindFixture.run('run-3', { status: 'running' }));
  const first = transcript
    .locator('.live-message')
    .filter({ hasText: 'Add a search box' })
    .getByRole('button', { name: 'Edit from here' });
  await page.waitForFunction(
    (node) => node.getAttribute('aria-disabled') === 'true',
    await first.elementHandle(),
  );
  await first.focus();
  await page
    .getByRole('tooltip')
    .getByText('Stop the running turn before rewinding.')
    .first()
    .waitFor();
  await page.keyboard.press('Enter');
  assert.equal(await page.getByRole('dialog').count(), 0, 'a disabled rewind opens nothing');
  await page.evaluate(() => window.rewindFixture.run('run-3', { status: 'review' }));

  // Agents that cannot return their conversation never show it.
  await page.evaluate(() => window.rewindFixture.scenario('opencode'));
  await page.waitForFunction(() => !document.querySelector('.edit-from-here'));
  await page.evaluate(() => window.rewindFixture.scenario('codex'));
  await page.waitForFunction(() => document.querySelectorAll('.edit-from-here').length === 3);

  // Light theme, narrow window and reduced motion.
  await page.evaluate(() => window.rewindFixture.theme('light'));
  await page.setViewportSize({ width: 960, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await second.hover();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  assert.equal(overflow, false, 'No horizontal scroll at 960 by 640');
  await page.screenshot({ path: `${output}/light-960.png` });
  assert.deepEqual(errors, []);
  console.log('Rewind fixture passed.');
} finally {
  await browser.close();
}
