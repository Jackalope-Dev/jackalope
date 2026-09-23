import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from '../../apps/desktop/node_modules/vite/dist/node/index.js';

const directory = path.resolve('apps/desktop/scratch/workbench-ui');
const output = path.resolve('output/playwright/workbench');
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
import {WorkspacePresetPicker} from '../../src/components/layout/WorkspacePresetPicker';
import {WorkContext} from '../../src/components/tasks/WorkContext';
import {SessionTopics} from '../../src/components/sessions/SessionTopics';
import {TranscriptResult} from '../../src/components/sessions/TranscriptResult';
import {WorkFeedbackInbox} from '../../src/components/tasks/WorkFeedbackInbox';
import {ProjectVerification} from '../../src/components/tasks/ProjectVerification';
import WorkPaneWindow from '../../src/components/tasks/WorkPaneWindow';
import {saveWorkFeedback} from '../../src/lib/work-feedback';
import {useLiveSessionStore} from '../../src/stores/liveSessionStore';
import {useExecutionStore} from '../../src/stores/executionStore';
import {useProjectStore} from '../../src/stores/projectStore';
import {useWorkbenchStore} from '../../src/stores/workbenchStore';
import {useWorkViewStore} from '../../src/stores/workViewStore';
import '../../src/index.css';
const run={id:'fixture-run',taskId:'fixture-task',projectId:'fixture',projectName:'Atlas',projectPath:'C:/fixture',workspace:'C:/fixture/worktree',branch:'feature/focus',baseHead:'123456',agent:'codex',account:'Default',prompt:'Keep focus visible.',status:'review',startedAt:'2026-09-18T00:00:00Z',endedAt:'2026-09-18T00:01:00Z',sessionId:null,result:'## Ready\\nFocus stays visible.',activity:[],prompts:[],diagnostics:[],usage:{input:0,output:0,reported:false},contract:{requirements:[]}};
const chat={id:'chat',title:'Atlas work',request:{projectId:'fixture',projectName:'Atlas',projectPath:'C:/fixture',agent:'codex',isolated:true},topics:[],topicsRevision:0,messages:[{id:'one',text:'# UI\\nKeep focus',canceled:false},{id:'two',text:'# API\\nKeep retries bounded',canceled:false},{id:'three',text:'# UI\\nUse clear labels',canceled:false}],batches:[],draft:{text:'',revision:0}};
window.fixture={calls:[],running:false,reply:'',preset:()=>useWorkbenchStore.getState().presets.fixture,openTools:()=>useWorkViewStore.getState().open(run.id,'terminal'),setDraft:prompt=>useExecutionStore.getState().draft('test',{prompt}),getDraft:()=>useExecutionStore.getState().drafts.test?.prompt};
window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
window.fixture.calls.push({command,args});
if(command==='task_terminal_start'){window.fixture.running=true;return;}
if(command==='task_terminal_stop'){window.fixture.running=false;return;}
if(command==='task_terminal_status')return window.fixture.running?{generation:'one',workspace:'C:/fixture/worktree',running:true,cursor:16,reset:args.generation!=='one',output:args.cursor?'':'Fixture shell\\r\\n'}:null;
if(command==='live_session_topics'){const current=useLiveSessionStore.getState().sessions[0];if(args.revision!==current.topicsRevision)throw Error('Topics changed in another window');useLiveSessionStore.setState({sessions:[{...current,topics:args.topics,topicsRevision:current.topicsRevision+1}]});return;}
return null;}};
useProjectStore.setState({projects:[{id:'fixture',name:'Atlas',path:'C:/fixture',gitBranch:'master',worktrees:[],preferences:{},agentProvider:'codex'}],activeProjectId:'fixture'});
useExecutionStore.setState({runs:[run],runners:[],loading:false,discover:async()=>{},refresh:async()=>{}});
useLiveSessionStore.setState({sessions:[chat],runs:[],refresh:async()=>{}});
const params=new URLSearchParams(location.search);applyThemeTokens({...DEFAULT_THEME,isDark:params.get('theme')!=='light'});
function Fixture(){if(params.has('missing'))return <WorkPaneWindow id='missing-run' pane='changes'/>;const session=useLiveSessionStore(s=>s.sessions[0]);return <main style={{padding:24,display:'grid',gap:12,height:'100vh',overflow:'auto'}}><p>Browser fixture · no native execution</p><div><WorkspacePresetPicker projectId="fixture"/></div><WorkContext run={run}><SessionTopics session={session}/></WorkContext><button onClick={()=>saveWorkFeedback(run.taskId,run.id,'Check keyboard focus on the changed button.')}>Save pane feedback</button><ProjectVerification run={{...run,verification:{command:'pnpm test',checkedAt:'2026-09-18T00:02:00Z',result:{success:false,exitCode:1,stdout:'Failed assertion',stderr:'',durationMs:100}}}} onCorrect={async()=>{throw Error('Feedback storage full')}}/><WorkFeedbackInbox taskId={run.taskId} onFeedback={text=>{window.fixture.reply=text}}/><TranscriptResult content={'## Earlier result\\nSearchable older answer'} active={false} recent={false} onOpenLink={()=>{}}/></main>};
createRoot(document.getElementById('root')).render(<Fixture/>);
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
  const origin = `http://127.0.0.1:${server.httpServer.address().port}/scratch/workbench-ui/index.html`;
  browser = await chromium.launch({
    channel: process.platform === 'win32' ? 'msedge' : 'chrome',
    headless: true,
  });
  for (const [theme, width, height] of [
    ['dark', 1280, 840],
    ['light', 960, 640],
    ['dark', 480, 720],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}?theme=${theme}`);
    await page.getByRole('button', { name: 'Workspace layout' }).click();
    await page.getByRole('menuitem', { name: /Build/ }).click();
    assert.equal(await page.evaluate(() => window.fixture.preset()), 'build');
    await page.getByRole('button', { name: 'Task context', exact: true }).click();
    await page.getByRole('dialog').getByText('C:/fixture/worktree', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    await page.getByRole('button', { name: 'Start terminal', exact: true }).click();
    await page.getByRole('button', { name: 'Stop terminal', exact: true }).waitFor();
    await page.getByRole('textbox', { name: /Task terminal input/ }).focus();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 1);
    await page.keyboard.press('Shift+Escape');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Stop terminal');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Terminal');
    assert.equal(await page.evaluate(() => window.fixture.running), true);
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    await page.getByRole('button', { name: 'Stop terminal', exact: true }).click();
    await page.getByRole('button', { name: 'Start terminal', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(
      await page.getByRole('button', { name: 'Start terminal', exact: true }).count(),
      0,
    );
    await page.evaluate(() => window.fixture.openTools());
    await page.getByRole('button', { name: 'Start terminal', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `terminal-${theme}-${width}.png`) });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Workspace tools' }).click();
    await page.getByRole('menuitem', { name: 'Pop out review' }).click();
    await page.waitForFunction(() =>
      window.fixture.calls.some(
        (call) => call.command === 'task_work_window' && call.args.pane === 'changes',
      ),
    );
    await page.locator('main').evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.screenshot({ path: path.join(output, `tools-${theme}-${width}.png`) });
    await page.getByRole('button', { name: 'Topics', exact: true }).click();
    await page.getByRole('button', { name: 'Suggest topics' }).click();
    assert.equal(
      await page.evaluate(
        () => window.fixture.calls.filter((call) => call.command === 'live_session_topics').length,
      ),
      0,
    );
    await page.getByRole('button', { name: 'Save grouping' }).click();
    await page.getByRole('button', { name: 'UI 2 messages', exact: true }).click();
    await page.getByRole('textbox', { name: 'Topic title' }).first().fill('Interface');
    await page.getByRole('button', { name: 'Discard grouping changes' }).click();
    await page.getByRole('button', { name: 'UI 2 messages', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Change messages' }).click();
    await page.getByRole('textbox', { name: 'New topic title' }).fill('Interaction');
    await page.getByRole('searchbox', { name: 'Find topic messages' }).fill('retries');
    assert.equal(await page.getByRole('checkbox').count(), 1);
    await page.getByRole('searchbox', { name: 'Find topic messages' }).fill('');
    await page.getByRole('button', { name: 'Update topic' }).click();
    await page.getByRole('button', { name: 'Save grouping' }).click();
    await page.getByRole('button', { name: 'Interaction 2 messages', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `topics-${theme}-${width}.png`) });
    assert.equal(
      await page.getByRole('dialog').evaluate((node) => node.scrollWidth > node.clientWidth),
      false,
    );
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save pane feedback' }).click();
    await page.locator('summary').filter({ hasText: 'saved feedback item' }).click();
    await page.getByRole('button', { name: 'Add to reply draft' }).click();
    assert.match(
      await page.evaluate(() => window.fixture.reply),
      /Feedback from attempt fixture-run/,
    );
    assert.equal(await page.getByText('Searchable older answer', { exact: false }).count(), 1);
    await page.getByRole('button', { name: 'Format earlier response' }).click();
    await page.getByRole('heading', { name: 'Earlier result' }).waitFor();
    await page.getByRole('button', { name: 'Ask agent to fix' }).click();
    await page.getByText('Error: Feedback storage full', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Ask agent to fix' }).isEnabled(), true);
    assert.ok(
      await page.evaluate(() =>
        window.fixture.calls
          .filter((call) =>
            ['task_terminal_write', 'task_terminal_resize', 'task_terminal_stop'].includes(
              call.command,
            ),
          )
          .every((call) => call.args.generation === 'one'),
      ),
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: path.join(output, `${theme}-${width}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
  }
  const context = await browser.newContext();
  const main = await context.newPage();
  await main.goto(origin);
  await main.waitForFunction(() => !!window.fixture);
  const pane = await context.newPage();
  await pane.goto(`${origin}?workPane=fixture-run&pane=changes`);
  await pane.waitForFunction(() => !!window.fixture);
  await main.evaluate(() => window.fixture.setDraft('Unsaved main-window reply'));
  await pane.evaluate(() => window.fixture.setDraft('Separate review draft'));
  assert.equal(
    await main.evaluate(
      () => JSON.parse(localStorage.getItem('jackalope-execution-ui-v1')).state.drafts.test.prompt,
    ),
    'Unsaved main-window reply',
  );
  await pane.reload();
  await pane.waitForFunction(() => !!window.fixture);
  assert.equal(await pane.evaluate(() => window.fixture.getDraft()), 'Separate review draft');
  await pane.getByRole('button', { name: 'Save pane feedback' }).click();
  await main.locator('summary').filter({ hasText: 'saved feedback item' }).waitFor();
  assert.equal(await main.evaluate(() => window.fixture.getDraft()), 'Unsaved main-window reply');
  await context.close();
  const large = await browser.newPage({ viewport: { width: 960, height: 640 } });
  await large.goto(origin);
  await large.waitForFunction(() => !!window.fixture);
  await large.evaluate(async () => {
    const { useLiveSessionStore } = await import('/src/stores/liveSessionStore.ts');
    const session = useLiveSessionStore.getState().sessions[0];
    useLiveSessionStore.setState({
      sessions: [
        {
          ...session,
          messages: Array.from({ length: 1001 }, (_, index) => ({
            id: `large-${index}`,
            text: `Message ${index} about the workspace`,
            canceled: false,
          })),
        },
      ],
    });
  });
  await large.getByRole('button', { name: 'Topics', exact: true }).click();
  await large.getByRole('button', { name: 'New topic', exact: true }).click();
  assert.equal(await large.getByRole('checkbox').count(), 100);
  await large.getByRole('button', { name: 'Show more messages' }).click();
  assert.equal(await large.getByRole('checkbox').count(), 200);
  await large.getByRole('searchbox', { name: 'Find topic messages' }).fill('Message 1000 ');
  assert.equal(await large.getByRole('checkbox').count(), 1);
  await large.getByRole('checkbox').check();
  await large.getByRole('textbox', { name: 'New topic title' }).fill('Last message');
  await large.keyboard.press('Escape');
  await large.getByRole('button', { name: 'Topics', exact: true }).click();
  assert.equal(
    await large.getByRole('textbox', { name: 'New topic title' }).inputValue(),
    'Last message',
  );
  assert.equal(await large.getByRole('checkbox').isChecked(), true);
  await large.getByRole('button', { name: 'Add topic', exact: true }).click();
  await large.getByRole('button', { name: 'Save grouping', exact: true }).click();
  await large.getByRole('button', { name: 'Last message 1 message', exact: true }).waitFor();
  await large.close();
  const missing = await browser.newPage();
  await missing.goto(`${origin}?missing=1`);
  await missing.getByText('This task is no longer available in history.').waitFor();
  await missing.getByRole('button', { name: 'Reload task' }).click();
  await missing.getByRole('button', { name: 'Return to task' }).click();
  await missing.waitForFunction(() =>
    window.fixture.calls.some(
      (call) => call.command === 'task_work_window' && call.args.action === 'dock',
    ),
  );
  await missing.close();
  console.log(
    'Workbench browser fixtures passed: layouts, terminal reconnect/control focus, popout routing, reversible topics, saved feedback and failure recovery, missing tasks, older transcript and three viewport/theme combinations. Native execution is tested separately.',
  );
} finally {
  await browser?.close();
  await server.close();
}
