import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Renders the sidebar group and the read-only view of conversations from outside
// Jackalope with fixture sessions and a fake native bridge. Nothing is read from a
// real CLI store and nothing runs.
const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5193';
const output = 'output/playwright/external-sessions';
await mkdir(output, { recursive: true });
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {WorkSidebar} from '/src/components/layout/WorkSidebar.tsx';
import {ExternalSessionView} from '/src/components/sessions/ExternalSessionView.tsx';
import {useExternalSessionStore} from '/src/stores/externalSessionStore.ts';
import {useLiveSessionStore} from '/src/stores/liveSessionStore.ts';
import {useExecutionStore} from '/src/stores/executionStore.ts';
import {useProjectStore} from '/src/stores/projectStore.ts';
import {applyThemeTokens,DEFAULT_THEME} from '/node_modules/@jackalope/brand/src/theme.ts';
import '/src/index.css';
import '/src/components/layout/workspace-shell.css';
const session=(n,extra={})=>({key:'claude:5f0e1d2c-0000-4000-8000-00000000000'+n,agent:n%2?'claude':'codex',agentName:n%2?'Claude Code':'Codex',sessionId:'5f0e1d2c-0000-4000-8000-00000000000'+n,projectId:'atlas',title:'Fixture conversation '+n+' about keyboard search in the command palette',cwd:'/Projects/atlas/.worktrees/search',branch:'search',startedAt:'2026-11-10T09:00:00Z',updatedAt:'2026-11-1'+n+'T10:00:00Z',unavailable:null,...extra});
const sessions=[session(1),session(2),session(3),session(4,{unavailable:'Claude Code saved this conversation in /Users/fixture/.claude-work, which is not one of your Claude Code accounts in Jackalope. Add that folder as an account in Agents to continue it here.'}),session(5)];
useProjectStore.setState({projects:[{id:'atlas',name:'Atlas',path:'/Projects/atlas',gitBranch:'main',worktrees:[],agentProvider:'codex'}],activeProjectId:'atlas',loadWorktreesForActiveProject:async()=>{}});
useExecutionStore.setState({runs:[],selectedId:null,loading:false,refresh:async()=>{}});
useLiveSessionStore.setState({sessions:[],runs:[],loading:false,refresh:async()=>{}});
useExternalSessionStore.setState({enabled:true,sessions,loaded:true,error:null,refresh:async()=>{}});
const f=window.externalFixture={calls:[],theme:appearance=>applyThemeTokens({...DEFAULT_THEME,isDark:appearance==='dark'}),conversation:()=>useLiveSessionStore.getState().selectedId};
f.theme('light');
window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
 f.calls.push({...args,command});
 if(command==='external_session_transcript')return {session:sessions.find(s=>s.key===args.key),earlier:0,subagentLines:3,entries:[
  {role:'user',text:'Make the command palette searchable with arrow keys'},
  {role:'assistant',text:'I will look at the palette component first.'},
  {role:'tools',text:'',tools:['Read','Edit','Edit','Bash']},
  {role:'assistant',text:'Arrow keys now move the selection, and **Enter** opens the item.'},
 ]};
 if(command==='external_session_continue')return 'continued-conversation';
 throw new Error('Unexpected fixture command: '+command);
}};
function Page(){
 const selected=useExternalSessionStore(s=>s.sessions.find(x=>x.key===s.selectedKey));
 return React.createElement('div',{className:'workspace-shell',style:{display:'flex',height:'100vh',gap:8,padding:8,background:'var(--color-bg)'}},
  React.createElement('aside',{className:'workspace-navigation',style:{width:260,flex:'none',overflow:'auto'}},
   React.createElement(WorkSidebar,{activeTab:'kanban',onOpen:()=>{},onAddProject:()=>{},onOpenProject:()=>{},onNewWork:()=>{},onRemoveProject:()=>{},onCopyPath:()=>{}})),
  React.createElement('main',{className:'workspace-canvas'},selected?React.createElement(ExternalSessionView,{key:selected.key,session:selected}):React.createElement('p',null,'Nothing open')));
}
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

  // A quiet group under the project: the newest three, then the rest on request.
  const group = page.getByRole('list', { name: 'Outside Jackalope' });
  await group.waitFor();
  assert.equal(await group.getByRole('listitem').count(), 3);
  const more = page.getByRole('button', { name: 'Show 2 more' });
  await more.click();
  assert.equal(await group.getByRole('listitem').count(), 5);
  assert.equal(
    await page.getByRole('button', { name: 'Show fewer' }).getAttribute('aria-expanded'),
    'true',
  );

  // Keyboard: a row opens with Enter and is marked as the open page.
  const first = group.getByRole('button', { name: /Fixture conversation 1/ });
  await first.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: /Fixture conversation 1/ }).waitFor();
  assert.equal(await first.getAttribute('aria-current'), 'page');
  await page.getByText('Make the command palette searchable with arrow keys').waitFor();
  await page.getByText('Used Read, Edit, Bash').waitFor();
  await page.getByText('Subagent work is not shown.').waitFor();

  // Continue: the header action focuses the composer, and sending opens the new conversation.
  await page.getByRole('button', { name: 'Continue in Jackalope' }).click();
  const composer = page.getByRole('textbox', { name: 'Continue this Claude Code conversation' });
  assert.ok(await composer.evaluate((node) => node === document.activeElement));
  assert.ok(await page.getByRole('button', { name: 'Continue', exact: true }).isDisabled());
  await composer.fill('Also support Home and End');
  for (const width of [1280, 960, 680]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const appearance of ['light', 'dark']) {
      await page.evaluate((value) => window.externalFixture.theme(value), appearance);
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: appearance });
      const overflow = await page.evaluate(() => {
        const main = document.querySelector('main');
        return main.scrollWidth - main.clientWidth;
      });
      assert.ok(overflow <= 1, `Horizontal overflow at ${width}px: ${overflow}`);
      await page.screenshot({ path: `${output}/view-${width}-${appearance}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForFunction(
    () => window.externalFixture.conversation() === 'continued-conversation',
  );
  const call = await page.evaluate(() =>
    window.externalFixture.calls.find((c) => c.command === 'external_session_continue'),
  );
  assert.equal(call.key, 'claude:5f0e1d2c-0000-4000-8000-000000000001');
  assert.equal(call.text, 'Also support Home and End');

  // One that cannot continue says why instead of offering the composer.
  const blocked = group.getByRole('button', { name: /Fixture conversation 4/ });
  await blocked.click();
  await page.getByText(/not one of your Claude Code accounts in Jackalope/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Continue in Jackalope' }).count(), 0);
  assert.equal(await page.getByRole('textbox').count(), 0);
  await page.screenshot({ path: `${output}/unavailable.png` });
  assert.deepEqual(errors, []);
  console.log('External sessions fixture passed; screenshots in', output);
} finally {
  await browser.close();
}
