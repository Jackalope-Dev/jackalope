import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from '../../apps/desktop/node_modules/vite/dist/node/index.js';

const directory = path.resolve('apps/desktop/scratch/workflow-ui');
const output = path.resolve('output/playwright/workflow-velocity');
mkdirSync(directory, { recursive: true });
mkdirSync(output, { recursive: true });
const patch =
  'diff --git a/src/button.tsx b/src/button.tsx\n--- a/src/button.tsx\n+++ b/src/button.tsx\n@@ -1,3 +1,3 @@\n export function Button() {\n-  return <button>Submit</button>;\n+  return <button>Save changes</button>;\n }\n';
writeFileSync(
  path.join(directory, 'index.html'),
  '<html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>',
);
writeFileSync(
  path.join(directory, 'fixture.tsx'),
  String.raw`
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {applyThemeTokens, DEFAULT_THEME} from '@jackalope/brand/theme';
import {ReviewFeedback} from '../../src/components/tasks/ReviewFeedback';
import {ChangedFiles} from '../../src/components/tasks/ChangedFiles';
import {IssuePicker} from '../../src/components/tasks/IssuePicker';
import {DesignPreview} from '../../src/components/tasks/DesignPreview';
import {RemoteAccess} from '../../src/components/settings/RemoteAccess';
import {SessionComposer} from '../../src/components/sessions/SessionComposer';
import {TaskDetail} from '../../src/components/tasks/TaskDetail';
import {useExecutionStore} from '../../src/stores/executionStore';
import {useProjectStore} from '../../src/stores/projectStore';
import '../../src/index.css';
import '../../src/components/tasks/task-workspace.css';
import '../../src/components/tasks/task-detail.css';
import '../../src/components/ui/experience.css';
const patch=${JSON.stringify(patch)};
const run={id:'fixture-run',taskId:'fixture-task',projectId:'fixture-project',projectName:'Atlas',projectPath:'C:/fixture',workspace:'C:/fixture/worktree',branch:'feature/focus',baseHead:'123456',agent:'codex',account:'Default',prompt:'Make the project settings easier to use.',status:'review',startedAt:'2026-09-18T00:00:00Z',endedAt:'2026-09-18T00:01:00Z',sessionId:'fixture-session',result:'## Changes ready\nThe settings form now keeps keyboard focus and uses a clearer action label.',activity:[],prompts:[],screenshots:[],validationSteps:[],diagnostics:[],usage:{input:0,output:0,reported:false},contract:{requirements:[]}};
useExecutionStore.setState({runs:[run]});
useProjectStore.setState({projects:[{id:'fixture-project',name:'Atlas',path:'C:/fixture',gitBranch:'master',worktrees:[],preferences:{},agentProvider:'codex'}]});
const params = new URLSearchParams(location.search);
applyThemeTokens({...DEFAULT_THEME,isDark:params.get('theme')!=='light'});
window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
 if(command==='remote_status') { window.remoteReads=(window.remoteReads??0)+1; if(params.get('failStatus') && window.remoteReads===1) throw new Error('Read failed'); return {enabled:true,listening:true,port:9472,publicOrigin:'https://host.example',projectIds:['fixture-project'],devices:window.fixtureDevices??[],error:null}; }
 if(command==='live_session_draft') return {text:args.text,revision:1};
 if(command==='project_issues') return {items:[{id:'42',title:'Keep focus in the settings dialog',url:'https://github.com/example/atlas/issues/42',state:'OPEN',provider:'github',kind:'issue',body:'Tab should stay inside the dialog. Escape should return focus to the trigger.',truncated:false}],next:null};
 if(command==='task_review')return {files:['src/button.tsx'],diff:patch,note:'Fixture patch'};
 if(command==='task_preview_status')return null;
 if(command==='task_followup_snapshot')return [];
 if(command==='task_preview_design_capture')return window.fixtureCapture??null;
 if(command==='task_preview_design_open')return null;
 if(command==='task_screenshot')return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4W8AAAAASUVORK5CYII=';
 if(command==='task_outcome_snapshot')return null;
 if(command==='project_git_policy')return {enabled:false};
 return [];
}};
function ComposerFixture(){const [addition,setAddition]=useState(); const [result,setResult]=useState(''); return <><button onClick={()=>setAddition(value=>({text:'Fix focus.',revision:(value?.revision??0)+1,applied:error=>setResult(error??'Draft saved')}))}>Add feedback</button><SessionComposer session={{id:'fixture-chat',closed:false,draft:{text:'Existing draft.',revision:0}}} addition={addition} onSent={async()=>{}}/><p data-testid="feedback-result">{result}</p></>}
function Fixture(){const [draft,setDraft]=useState('Existing draft.');const view=params.get('view');return <main style={{height:'100dvh',overflow:'auto',padding:24}}><p>Browser fixture · no native execution</p>{view==='access'?<RemoteAccess/>:view==='composer'?<ComposerFixture/>:view==='issues'?<IssuePicker projectPath="C:/fixture" onDraft={setDraft}/>:view==='preview'?<DesignPreview runId="fixture-run" path="/" onFeedback={setDraft}/>:view==='task'?<div style={{height:'calc(100dvh - 90px)'}}><TaskDetail run={run} onBack={()=>{}} onSchedule={()=>{}} onCapture={()=>{}}/></div>:<ReviewFeedback taskId="fixture-review" revision="one" files={['src/button.tsx']} onFeedback={params.has('readonly')?undefined:setDraft}><ChangedFiles files={['src/button.tsx']} patch={patch}/></ReviewFeedback>}{!['task','access','composer'].includes(view)&&<label>Follow-up<textarea aria-label="Follow-up" value={draft} onChange={e=>setDraft(e.target.value)}/></label>}</main>};
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
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({
    channel: process.platform === 'win32' ? 'msedge' : 'chrome',
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 840 },
    reducedMotion: 'reduce',
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const fixture = `${origin}/scratch/workflow-ui/index.html`;
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Add comment', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor();
  await page
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('Keep the focus indicator visible.');
  await page.getByRole('spinbutton', { name: 'Line' }).fill('2');
  await page.getByRole('button', { name: 'Save comment', exact: true }).click();
  assert.ok(
    await page
      .getByRole('button', { name: 'Add comment', exact: true })
      .evaluate((element) => element === document.activeElement),
  );
  await page.getByRole('button', { name: 'Add 1 comment to follow-up' }).click();
  assert.match(
    await page.getByRole('textbox', { name: 'Follow-up' }).inputValue(),
    /src\/button.tsx:2/,
  );
  await page.reload();
  await page.getByRole('button', { name: 'Add 1 comment to follow-up' }).waitFor();
  await page.locator('.review-inline-comment').waitFor();
  await page.screenshot({ path: path.join(output, 'review-dark.png') });
  await page.goto(`${fixture}?readonly`);
  await page.locator('.review-inline-comment').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Add comment', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Add 1 comment to follow-up' }).count(), 0);
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Add 1 comment to follow-up' }).count(), 0);
  await page.goto(`${fixture}?view=issues&theme=light`);
  await page.getByRole('button', { name: /Keep focus in the settings dialog/ }).click();
  await page.getByRole('button', { name: 'Use this issue' }).click();
  assert.match(
    await page.getByRole('textbox', { name: 'Follow-up' }).inputValue(),
    /Source: https:\/\/github.com/,
  );
  await page.setViewportSize({ width: 960, height: 640 });
  await page.screenshot({ path: path.join(output, 'issues-light-narrow.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.goto(`${fixture}?view=task&theme=light`);
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Show conversation', exact: true }).click();
  await page
    .getByText('The settings form now keeps keyboard focus and uses a clearer action label.')
    .waitFor();
  await page.screenshot({ path: path.join(output, 'split-narrow.png') });
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.screenshot({ path: path.join(output, 'split-wide.png') });
  await page.goto(`${fixture}?view=preview`);
  await page.evaluate(() => {
    window.fixtureCapture = {
      selection: {
        id: 'selection-a',
        url: 'http://127.0.0.1:4000/settings',
        tag: 'button',
        html: '<button>Save changes</button>',
        styles: { color: 'white' },
        source: null,
      },
      screenshot: {
        id: 'image-a',
        name: 'Selected button',
        filePath: 'C:/fixture/screenshot.png',
        width: 100,
        height: 40,
        timestamp: '2026-09-18T00:00:00Z',
        url: 'http://127.0.0.1:4000',
      },
      contextPath: 'C:/fixture/selection.json',
    };
  });
  await page.getByRole('textbox', { name: 'Change to button' }).fill('Increase the target size.');
  await page.reload();
  assert.equal(
    await page.getByRole('textbox', { name: 'Change to button' }).inputValue(),
    'Increase the target size.',
  );
  await page.getByRole('button', { name: 'Add selections to follow-up' }).click();
  assert.match(
    await page.getByRole('textbox', { name: 'Follow-up' }).inputValue(),
    /selection.json/,
  );
  await page.reload();
  assert.equal(await page.getByRole('textbox', { name: 'Change to button' }).count(), 0);
  await page.evaluate(() =>
    localStorage.setItem('jackalope-preview-selections:fixture-run', '{unreadable'),
  );
  await page.reload();
  await page
    .getByText('Saved selections could not be read. The original record is preserved.')
    .waitFor();
  assert.ok(
    await page.getByRole('button', { name: 'Select in preview', exact: true }).isDisabled(),
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem('jackalope-preview-selections:fixture-run')),
    '{unreadable',
  );
  await page.evaluate(() => localStorage.setItem('jackalope-preview-selections:fixture-run', '[]'));
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  assert.ok(await page.getByRole('button', { name: 'Select in preview', exact: true }).isEnabled());
  await page.goto(`${fixture}?view=access&failStatus=1&theme=light`);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('button', { name: 'Create pairing link' }).waitFor();
  await page.getByText('Connection settings', { exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Local port', exact: true }).fill('9560');
  await page.evaluate(() => {
    window.fixtureDevices = [
      { id: 'phone', name: 'Test phone', pairedAt: new Date().toISOString() },
    ];
  });
  await page.getByText('Test phone', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('spinbutton', { name: 'Local port', exact: true }).inputValue(),
    '9560',
  );
  await page.screenshot({ path: path.join(output, 'remote-settings-light.png'), fullPage: true });
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto(`${fixture}?view=access`);
  await page.getByRole('button', { name: 'Create pairing link' }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({
    path: path.join(output, 'remote-settings-dark-narrow.png'),
    fullPage: true,
  });
  await page.goto(`${fixture}?view=composer`);
  await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
  await page.evaluate(() => {
    window.originalStorageWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('jackalope-live-draft:'))
        throw new DOMException('Quota', 'QuotaExceededError');
      return window.originalStorageWrite.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'Add feedback', exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="feedback-result"]')
      .textContent.includes('could not be saved'),
  );
  assert.equal(
    await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(),
    'Existing draft.',
  );
  await page.evaluate(() => {
    Storage.prototype.setItem = window.originalStorageWrite;
  });
  await page.getByRole('button', { name: 'Add feedback', exact: true }).click();
  await page.getByText('Draft saved', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(),
    'Existing draft.\n\nFix focus.',
  );
  await page.reload();
  assert.equal(
    await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(),
    'Existing draft.\n\nFix focus.',
  );
  const picker = await browser.newPage();
  await picker.goto(origin);
  await picker.setContent(
    '<button id="target">Save draft</button><textarea id="private">private value</textarea>',
  );
  const source = readFileSync('apps/desktop/src-tauri/src/commands/previews/picker.js', 'utf8');
  await picker.evaluate(source);
  await picker.locator('#target').click();
  const capture = await picker.evaluate(() => window.__jackalopePreviewPicker.selection);
  assert.match(capture.html, /Save draft/);
  assert.ok(capture.styles['font-size']);
  await picker.evaluate(() => {
    window.__jackalopePreviewPicker.picking = true;
  });
  await picker.locator('#private').click();
  assert.doesNotMatch(
    await picker.evaluate(() => window.__jackalopePreviewPicker.selection.html),
    /private value/,
  );
  await picker.close();
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    colorScheme: 'light',
  });
  phone.on('pageerror', (error) => errors.push(error.message));
  const sends = [];
  let failSend = true;
  const task = {
    id: 'run-a',
    taskId: 'task-a',
    sessionId: 'session-a',
    projectId: 'project',
    projectName: 'Atlas',
    title: 'Improve keyboard navigation',
    status: 'running',
    startedAt: '2026-09-18',
    result: 'The dialog is ready for review.',
    error: null,
    activity: [],
    prompts: [
      {
        id: 'question-a',
        runId: 'run-a',
        question: 'Should Escape return to the project?',
        inputType: 'choice',
        options: ['Yes', 'No'],
        status: 'pending',
      },
    ],
  };
  await phone.addInitScript(() =>
    localStorage.setItem('jackalope-companion-device', 'fixture-token'),
  );
  await phone.route('**/api/request', async (route) => {
    const action = route.request().postDataJSON();
    if (action.action === 'followup') {
      sends.push(action);
      if (failSend) {
        failSend = false;
        await route.abort();
        return;
      }
    }
    const body =
      action.action === 'snapshot'
        ? {
            projects: [{ id: 'project', name: 'Atlas' }],
            tasks: [task],
            sessions: [
              {
                id: 'session-a',
                projectId: 'project',
                title: task.title,
                paused: false,
                pending: 0,
              },
            ],
          }
        : action.action === 'detail'
          ? task
          : action.action === 'review'
            ? { files: ['src/button.tsx'], diff: patch, note: 'Fixture review' }
            : { accepted: true };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await phone.goto(`${origin}/companion.html`);
  await phone.getByRole('button', { name: /Improve keyboard navigation/ }).click();
  await phone.getByRole('heading', { name: 'Should Escape return to the project?' }).waitFor();
  await phone
    .getByRole('textbox', { name: 'Follow-up', exact: true })
    .fill('Keep the existing shortcut.');
  await phone.getByRole('button', { name: 'Send', exact: true }).click();
  await phone.getByRole('alert').waitFor();
  assert.equal(
    await phone.getByRole('textbox', { name: 'Follow-up', exact: true }).inputValue(),
    'Keep the existing shortcut.',
  );
  task.id = 'run-b';
  await phone.reload();
  await phone.getByRole('button', { name: /Improve keyboard navigation/ }).click();
  await phone.getByRole('textbox', { name: 'Follow-up', exact: true }).waitFor();
  await phone.getByRole('button', { name: 'Send', exact: true }).click();
  await phone.waitForFunction(
    () => document.querySelector('.remote-composer textarea')?.value === '',
  );
  assert.equal(sends.length, 2);
  assert.equal(sends[0].id, sends[1].id);
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await phone.screenshot({ path: path.join(output, 'companion-phone.png'), fullPage: true });
  task.sessionId = null;
  task.id = 'ordinary-a';
  failSend = true;
  await phone.reload();
  await phone
    .getByRole('button', { name: /Improve keyboard navigation/ })
    .last()
    .click();
  await phone
    .getByRole('textbox', { name: 'Follow-up', exact: true })
    .fill('Follow this task across attempts.');
  await phone.getByRole('button', { name: 'Send', exact: true }).click();
  await phone.getByRole('alert').waitFor();
  task.id = 'ordinary-b';
  await phone.reload();
  await phone
    .getByRole('button', { name: /Improve keyboard navigation/ })
    .last()
    .click();
  await phone.getByRole('button', { name: 'Send', exact: true }).click();
  await phone.waitForFunction(
    () => document.querySelector('.remote-composer textarea')?.value === '',
  );
  assert.equal(sends.length, 4);
  assert.equal(sends[2].id, sends[3].id);
  assert.equal(sends[3].runId, 'ordinary-a');
  await phone.route('**/api/pair', async (route) => {
    const { code } = route.request().postDataJSON();
    await route.fulfill({
      status: code === 'fresh-code' ? 200 : 403,
      contentType: 'application/json',
      body: JSON.stringify(
        code === 'fresh-code'
          ? { token: 'new-fixture-token' }
          : { error: 'Pairing expired. Create a new link on the host.' },
      ),
    });
  });
  await phone.goto(`${origin}/companion.html#pair=expired-code`);
  await phone.getByRole('button', { name: 'Connect', exact: true }).click();
  await phone.getByLabel('Pairing code', { exact: true }).fill('fresh-code');
  await phone.getByRole('button', { name: 'Connect', exact: true }).click();
  await phone.getByRole('button', { name: 'Disconnect', exact: true }).click();
  assert.equal(await phone.getByLabel('Pairing code', { exact: true }).inputValue(), '');
  assert.ok(await phone.getByRole('button', { name: 'Connect', exact: true }).isDisabled());
  await phone.screenshot({
    path: path.join(output, 'companion-pairing-phone.png'),
    fullPage: true,
  });
  await phone.emulateMedia({ colorScheme: 'dark' });
  await phone.screenshot({ path: path.join(output, 'companion-pairing-dark.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'Workflow UI fixtures passed: review comments, split view, issue intake, retained selections, picker state and reconnect-safe companion sends. Native execution and live accounts are separate checks.',
  );
} finally {
  await browser?.close();
  await server.close();
  unlinkSync(path.join(directory, 'index.html'));
  unlinkSync(path.join(directory, 'fixture.tsx'));
}
