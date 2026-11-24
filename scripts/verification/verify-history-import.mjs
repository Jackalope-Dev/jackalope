import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Renders the import dialog, the Imported sidebar group and an imported conversation with
// fixture scans and a fake native bridge. Nothing is read from a real CLI store and
// nothing is imported or run.
const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5194';
const output = 'output/playwright/history-import';
await mkdir(output, { recursive: true });
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {WorkSidebar} from '/src/components/layout/WorkSidebar.tsx';
import {HistoryImportHost} from '/src/components/sessions/ImportHistoryDialog.tsx';
import {ImportedConversationView} from '/src/components/sessions/ImportedConversationView.tsx';
import {openHistoryImport} from '/src/lib/app-events.ts';
import {useImportedConversationStore} from '/src/stores/importedConversationStore.ts';
import {useExternalSessionStore} from '/src/stores/externalSessionStore.ts';
import {useLiveSessionStore} from '/src/stores/liveSessionStore.ts';
import {useExecutionStore} from '/src/stores/executionStore.ts';
import {useProjectStore} from '/src/stores/projectStore.ts';
import {useOnboardingStore} from '/src/stores/onboardingStore.ts';
import {applyThemeTokens,DEFAULT_THEME} from '/node_modules/@jackalope/brand/src/theme.ts';
import '/src/index.css';
import '/src/components/layout/workspace-shell.css';
window.__TAURI_INTERNALS__={invoke:async()=>{throw new Error('not ready')}};
const now=Date.now(), day=86400000;
const at=(days)=>new Date(now-days*day).toISOString();
const candidate=(n,agent,days,status,extra={})=>({key:agent+':5f0e1d2c-0000-4000-8000-00000000000'+n,agent,agentName:agent==='claude'?'Claude Code':'Codex',sessionId:'5f0e1d2c-0000-4000-8000-00000000000'+n,title:'Fixture conversation '+n+' about the command palette keyboard search',cwd:'/Projects/atlas',branch:'main',startedAt:at(days),lastAt:at(days),messages:n*7,status,...extra});
const atlas={path:'/Projects/atlas',projectId:'atlas',exists:true,repository:true,sessions:[candidate(1,'claude',1,'new'),candidate(2,'codex',3,'changed'),candidate(3,'claude',10,'imported'),candidate(4,'codex',120,'new')]};
const beacon={path:'/Projects/beacon',projectId:null,exists:true,repository:true,sessions:[candidate(5,'claude',2,'new',{cwd:'/Projects/beacon'})]};
const gone={path:'/tmp/scratch',projectId:null,exists:false,repository:false,sessions:[candidate(6,'claude',4,'new',{cwd:'/tmp/scratch'})]};
let scan={groups:[atlas,beacon,gone],stores:['/Users/fixture/.claude','/Users/fixture/.codex'],error:null};
const imported=(n,extra={})=>({id:'claude:5f0e1d2c-0000-4000-8000-00000000000'+n,agent:'claude',agentName:'Claude Code',sessionId:'5f0e1d2c-0000-4000-8000-00000000000'+n,projectId:'atlas',title:'Imported fixture conversation '+n,cwd:'/Projects/atlas',branch:'main',startedAt:at(5),lastAt:at(5),importedAt:at(0),messages:12,earlier:0,skippedLines:0,subagentLines:0,sourcePath:'/Users/fixture/.claude/projects/-atlas/x.jsonl',continuedIn:null,unavailable:null,changed:false,...extra});
let progress={running:false,canceled:false,total:0,done:0,imported:0,updated:0,unchanged:0,problems:[],current:null,error:null};
let conversations=[imported(7),imported(8,{changed:true,unavailable:'Claude Code is turned off for this project in Settings.'})];
const f=window.importFixture={calls:[],theme:appearance=>applyThemeTokens({...DEFAULT_THEME,isDark:appearance==='dark'}),
 finish:()=>{progress={...progress,running:false,done:progress.total,imported:progress.total-1,problems:[{key:'x',title:'Fixture conversation 2',reason:'It was continued in Jackalope, so its later turns are already here.'}]};atlas.sessions[0].status='imported';useImportedConversationStore.getState().refresh();},
 open:openHistoryImport};
f.theme('light');
window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
 f.calls.push({...args,command});
 if(command==='session_import_scan')return scan;
 if(command==='session_import_start'){progress={...progress,running:true,total:args.keys.length,done:1,current:'Fixture conversation 1'};return null;}
 if(command==='session_import_cancel')return null;
 if(command==='imported_conversations_list')return {conversations,progress,error:null};
 if(command==='imported_conversation_transcript')return {conversation:conversations.find(c=>c.id===args.id),entries:[
  {role:'user',text:'Make the command palette searchable with arrow keys',attachments:['Image (image/png)']},
  {role:'assistant',text:'I will look at the palette component first.'},
  {role:'tools',text:'',tools:[{name:'Read',summary:'src/palette.tsx'},{name:'Bash',summary:'pnpm test palette'}]},
  {role:'assistant',text:'Arrow keys now move the selection.'},
 ]};
 if(command==='imported_conversation_continue')return 'continued-conversation';
 if(command==='task_validate_project')return {path:args.path,name:'beacon',branch:'main',repository:true};
 if(command==='project_registry_save'||command==='project_registry_list')return [];
 return null;
}};
useProjectStore.setState({projects:[{id:'atlas',name:'Atlas',path:'/Projects/atlas',gitBranch:'main',worktrees:[]}],activeProjectId:'atlas',loadWorktreesForActiveProject:async()=>{}});
useExecutionStore.setState({runs:[],selectedId:null,loading:false,refresh:async()=>{}});
useLiveSessionStore.setState({sessions:[],runs:[],loading:false,refresh:async()=>{}});
useExternalSessionStore.setState({enabled:true,sessions:[],loaded:true,error:null,refresh:async()=>{}});
useOnboardingStore.setState({status:'complete',historyOffer:'due'});
function Page(){
 const selected=useImportedConversationStore(s=>s.conversations.find(x=>x.id===s.selectedId));
 return React.createElement('div',{className:'workspace-shell',style:{display:'flex',height:'100vh',gap:8,padding:8,background:'var(--color-bg)'}},
  React.createElement('aside',{className:'workspace-navigation',style:{width:260,flex:'none',overflow:'auto'}},
   React.createElement(WorkSidebar,{activeTab:'kanban',onOpen:()=>{},onAddProject:()=>{},onOpenProject:()=>{},onNewWork:()=>{},onRemoveProject:()=>{},onCopyPath:()=>{}})),
  React.createElement('main',{className:'workspace-canvas'},selected?React.createElement(ImportedConversationView,{key:selected.id,conversation:selected}):React.createElement('p',null,'Nothing open')),
  React.createElement(HistoryImportHost,{ready:true}));
}
useImportedConversationStore.getState().refresh();
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,
React.createElement('p',{style:{position:'fixed',bottom:0,right:4,zIndex:90,fontSize:10,pointerEvents:'none'}},'Browser fixture only; no native execution'),
React.createElement(Page)));
`;
const browser = await chromium.launch({
  channel: process.env.UI_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chrome'),
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/src/main.tsx*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fixture }),
  );
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // The one-time offer opens on its scan, with new and changed project conversations chosen.
  const dialog = page.getByRole('dialog', { name: 'Bring your Claude Code and Codex history' });
  await dialog.waitFor();
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('jackalope-onboarding-v1')).state.historyOffer,
    ),
    'done',
  );
  const importButton = dialog.getByRole('button', { name: 'Import 3 conversations' });
  await importButton.waitFor();
  await dialog.getByText('6 conversations found').waitFor();
  await dialog.getByText(/ran in folders that no longer exist/).waitFor();
  const all = dialog.getByRole('checkbox', { name: 'Select all conversations in Atlas' });
  assert.ok(await all.isChecked());

  // Select-all per project and the date filter.
  await all.focus();
  await page.keyboard.press('Space');
  await dialog.getByRole('button', { name: 'Import', exact: true }).waitFor();
  assert.ok(await dialog.getByRole('button', { name: 'Import', exact: true }).isDisabled());
  await page.keyboard.press('Space');
  await importButton.waitFor();
  await dialog.getByRole('combobox', { name: 'Last active' }).click();
  await page.getByRole('option', { name: 'Past week' }).click();
  await dialog.getByRole('button', { name: 'Import 2 conversations' }).waitFor();
  await dialog.getByText('4 conversations found').waitFor();

  // A repository that is not a project offers to add it.
  await dialog.getByRole('button', { name: 'Add project' }).waitFor();
  await dialog.getByText(/Add this repository as a project/).waitFor();

  for (const width of [1280, 960, 680]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const appearance of ['light', 'dark']) {
      await page.evaluate((value) => window.importFixture.theme(value), appearance);
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: appearance });
      const overflow = await dialog.evaluate((node) =>
        Math.max(
          node.scrollWidth - node.clientWidth,
          ...[...node.querySelectorAll('.history-import-body')].map(
            (body) => body.scrollWidth - body.clientWidth,
          ),
        ),
      );
      const wide = await dialog.evaluate((node) => {
        const body = node.querySelector('.history-import-body').getBoundingClientRect();
        return [...node.querySelectorAll('.history-import-body *')]
          .filter((child) => child.getBoundingClientRect().right > body.right + 1)
          .map((child) => child.className || child.tagName)
          .slice(0, 5);
      });
      assert.ok(overflow <= 1, `Dialog overflows at ${width}px: ${overflow} ${wide}`);
      await page.screenshot({ path: `${output}/dialog-${width}-${appearance}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 840 });

  // Import runs in the background with progress and can be canceled.
  await dialog.getByRole('button', { name: 'Import 2 conversations' }).click();
  await dialog.getByText(/Importing 2 of 2/).waitFor();
  await dialog.getByRole('progressbar', { name: 'Import progress' }).waitFor();
  await dialog.getByRole('button', { name: 'Cancel import' }).click();
  await page.waitForFunction(() =>
    window.importFixture.calls.some((call) => call.command === 'session_import_cancel'),
  );
  const start = await page.evaluate(() =>
    window.importFixture.calls.find((call) => call.command === 'session_import_start'),
  );
  assert.deepEqual(start.keys.sort(), [
    'claude:5f0e1d2c-0000-4000-8000-000000000001',
    'codex:5f0e1d2c-0000-4000-8000-000000000002',
  ]);
  await page.evaluate(() => window.importFixture.finish());
  await dialog.getByText(/Finished: imported 1 conversation/).waitFor();
  await dialog.getByText('1 conversation was not imported').click();
  await dialog.getByText(/continued in Jackalope/).waitFor();
  await page.screenshot({ path: `${output}/finished.png` });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });

  // Command search and Settings open the same dialog without the offer copy.
  await page.evaluate(() => window.importFixture.open());
  await page.getByRole('dialog', { name: 'Import Claude and Codex history' }).waitFor();
  await page.keyboard.press('Escape');

  // Imported conversations list under their project and open read-only.
  const group = page.getByRole('list', { name: 'Imported' });
  await group.waitFor();
  await group.getByRole('button', { name: /Imported fixture conversation 7/ }).click();
  await page.getByRole('heading', { name: 'Imported fixture conversation 7' }).waitFor();
  await page.getByText('Imported from Claude Code').waitFor();
  await page.getByText('Image (image/png)').waitFor();
  await page.getByText('Used Read, Bash').click();
  await page.getByText('pnpm test palette').waitFor();
  const composer = page.getByRole('textbox', { name: 'Continue this Claude Code conversation' });
  await composer.fill('Also support Home and End');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForFunction(() =>
    window.importFixture.calls.some((call) => call.command === 'imported_conversation_continue'),
  );
  const call = await page.evaluate(() =>
    window.importFixture.calls.find((c) => c.command === 'imported_conversation_continue'),
  );
  assert.equal(call.id, 'claude:5f0e1d2c-0000-4000-8000-000000000007');
  assert.equal(call.text, 'Also support Home and End');

  // One that cannot continue says why, and one that grew offers an update.
  await group.getByRole('button', { name: /Imported fixture conversation 8/ }).click();
  await page.getByText(/turned off for this project/).waitFor();
  await page.getByText(/wrote to this conversation after it was imported/).waitFor();
  assert.equal(await page.getByRole('textbox').count(), 0);
  for (const appearance of ['light', 'dark']) {
    await page.evaluate((value) => window.importFixture.theme(value), appearance);
    await page.screenshot({ path: `${output}/imported-${appearance}.png` });
  }
  assert.deepEqual(errors, []);
  console.log('History import fixture passed; screenshots in', output);
} finally {
  await browser.close();
}
