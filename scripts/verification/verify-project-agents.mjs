import assert from 'node:assert/strict';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5192';
const output = 'output/playwright/project-agents';
await mkdir(output, { recursive: true });
const fixture = `
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RunnerConnections } from '/src/components/tasks/RunnerConnections.tsx';
import { AgentManager } from '/src/components/agents/AgentManager.tsx';
import { CaptureTask } from '/src/components/tasks/CaptureTask.tsx';
import { AgentPreferences } from '/src/components/settings/AgentPreferences.tsx';
import { useProjectStore } from '/src/stores/projectStore.ts';
import { useAgentConfigStore } from '/src/stores/agentConfigStore.ts';
import { useExecutionStore } from '/src/stores/executionStore.ts';
import { useThemeStore } from '/src/stores/themeStore.ts';
import '/src/index.css';
import '/src/components/tasks/task-workspace.css';
import '/src/components/ui/experience.css';
const f = window.projectFixture = { calls: [], failSave: false,
 state: () => ({ projects: useProjectStore.getState().projects, config: useAgentConfigStore.getState(), drafts: useExecutionStore.getState().drafts }),
 theme: dark => useThemeStore.getState().setAppTheme({ ...useThemeStore.getState().appTheme, isDark: dark, appearance: 'manual' }),
};
const profiles = [{id:'work-login',name:'Work login',group:'work'},{id:'personal-login',name:'Personal login',group:'personal'}];
window.__TAURI_INTERNALS__ = { transformCallback: () => 0, unregisterCallback: () => {}, invoke: async (command,args={}) => {
 f.calls.push({command,...args});
 switch(command) {
 case 'agent_save_policy': if(f.failSave)throw new Error('Fixture save failed'); return;
 case 'project_registry_save': return;
 case 'project_registry_list': return [];
 case 'agent_profile_list': return {profiles,activeId:'personal-login',envVar:'FIXTURE_HOME',defaultName:'CLI account'};
 case 'agent_profile_status': return {state:'signedIn',identity:args.id+'@example.test',detail:'Browser fixture only',checkedAt:new Date().toISOString()};
 case 'agent_models': return {models:[{id:'fixture-model',name:'Fixture model',isDefault:true}],source:'fixture',account:args.agentProfileId,detail:'Fixture'};
 case 'mcp_list_servers': case 'mcp_list': case 'list_mcp_servers': return [];
 case 'project_readiness': return {head:'fixture',branch:'main',changes:'',recentChanges:'',prepareCommand:null,verifyCommand:null,previewCommand:null,dependenciesMissing:false,missingConfiguration:[],notes:[]};
 case 'project_git_policy': return {attribution:'user',name:'Fixture',email:'fixture@example.test',cleanupAfterMerge:false,autoCheckpoint:false};
 case 'knowledge_snapshot': return {lessons:[],workflows:[],revision:0};
 default: return null;
 }
}};
if(!useProjectStore.getState().projects.length) useProjectStore.setState({activeProjectId:'work',projects:['work','personal'].map(id=>({id,name:id==='work'?'Work':'Personal',path:'/fixture/'+id,gitBranch:'main',worktrees:[],agentProvider:'codex',preferences:{preferredRunner:'codex'}}))});
useExecutionStore.setState({runners:['codex','claude'].map(id=>({id,name:id==='codex'?'Codex':'Claude Code',available:true,signedIn:true,account:'Fixture',detail:'Fixture'})),discover:async()=>{},discovering:false});
function App(){
 const [screen,setScreen]=React.useState('roster');
 const [agent,setAgent]=React.useState('claude');
 const active=useProjectStore(s=>s.activeProjectId);
 React.useEffect(()=>{const onAgent=e=>{setAgent(e.detail);setScreen('manager')};const onNav=()=>setScreen('roster');window.addEventListener('jackalope:configure-agent',onAgent);window.addEventListener('jackalope:navigate',onNav);return()=>{window.removeEventListener('jackalope:configure-agent',onAgent);window.removeEventListener('jackalope:navigate',onNav)}},[]);
 return React.createElement('main',{style:{height:'100vh',overflow:'auto'}},
 React.createElement('nav',{style:{display:'flex',gap:16,padding:16}},
 ...['work','personal'].map(id=>React.createElement('button',{key:id,onClick:()=>useProjectStore.setState({activeProjectId:id})},'Project '+id)),
 ...['roster','manager','capture','settings'].map(id=>React.createElement('button',{key:id,onClick:()=>setScreen(id)},'View '+id))),
 screen==='roster'?React.createElement(RunnerConnections,{onNewTask:id=>{setAgent(id);setScreen('capture')},onRun:()=>{}}):
 screen==='manager'?React.createElement(AgentManager,{key:active,initialAgentId:agent}):
 screen==='settings'?React.createElement(AgentPreferences,{key:active,projectId:active}):
 React.createElement(CaptureTask,{key:active,draftKey:'fixture:'+active,inline:true,onClose:()=>{},onStarted:()=>{}}));
}
f.theme(true);
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
`;
const fixturePath = `apps/desktop/scratch/project-agents-${process.pid}.tsx`;
await mkdir('apps/desktop/scratch', { recursive: true });
await writeFile(fixturePath, fixture);
const browser = await chromium.launch({
  channel: process.env.UI_BROWSER_CHANNEL ?? 'chrome',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/src/main.tsx*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `import "/scratch/project-agents-${process.pid}.tsx";`,
    }),
  );
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const workCodex = page.getByRole('switch', { name: 'Enable Codex for Work', exact: true });
  await workCodex.waitFor();
  await workCodex.focus();
  await page.keyboard.press('Space');
  assert.equal(await workCodex.getAttribute('aria-checked'), 'false');
  await page.getByRole('button', { name: 'Project personal', exact: true }).click();
  assert.equal(
    await page
      .getByRole('switch', { name: 'Enable Codex for Personal', exact: true })
      .getAttribute('aria-checked'),
    'true',
  );
  await page.getByRole('button', { name: 'Project work', exact: true }).click();
  await page.getByRole('button', { name: 'Configure Claude Code', exact: true }).click();
  await page.getByRole('button', { name: 'Make default', exact: true }).click();
  await page.getByRole('combobox', { name: 'Claude Code project account', exact: true }).click();
  await page.getByRole('option', { name: 'Work login', exact: true }).click();
  const allowPersonal = page.getByRole('switch', {
    name: 'Allow Claude Code account Personal login for Work',
    exact: true,
  });
  await allowPersonal.click();
  assert.equal(await allowPersonal.getAttribute('aria-checked'), 'false');
  const state = await page.evaluate(() => window.projectFixture.state());
  assert.equal(state.projects[0].preferences.preferredRunner, 'claude');
  assert.equal(state.projects[1].preferences.preferredRunner, 'codex');
  assert.equal(state.config.defaultMetaAgent, 'codex');
  assert.equal(state.config.enabledAgents.codex, true);
  assert.equal(state.projects[0].preferences.agentAccounts.claude, 'work-login');
  assert.deepEqual(state.projects[0].preferences.disabledAccounts.claude, ['personal-login']);
  assert.equal(
    await page.evaluate(() =>
      window.projectFixture.calls.some((c) => c.command === 'agent_profile_set_active'),
    ),
    false,
  );
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Claude Code project account"]').disabled,
  );
  await page.getByRole('combobox', { name: 'Claude Code project account', exact: true }).focus();
  await page.keyboard.press('Space');
  await page.getByRole('listbox').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('listbox').waitFor({ state: 'hidden' });
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Claude Code project account',
  );
  assert(
    await page
      .getByRole('combobox', { name: 'Claude Code project account', exact: true })
      .evaluate((el) => el === document.activeElement),
  );
  for (const width of [1280, 960]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const dark of [false, true]) {
      await page.emulateMedia({ reducedMotion: dark ? 'reduce' : 'no-preference' });
      await page.evaluate((dark) => window.projectFixture.theme(dark), dark);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.locator('main').evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.screenshot({ path: `${output}/manager-${width}-${dark ? 'dark' : 'light'}.png` });
      await page
        .getByRole('combobox', { name: 'Claude Code project account', exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/accounts-${width}-${dark ? 'dark' : 'light'}.png` });
    }
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(
    await page
      .getByRole('switch', { name: 'Enable Codex for Work', exact: true })
      .getAttribute('aria-checked'),
    'false',
  );
  await page.getByRole('button', { name: 'View capture', exact: true }).click();
  await page.waitForFunction(() =>
    window.projectFixture.calls.some(
      (c) =>
        c.command === 'agent_models' && c.agent === 'claude' && c.agentProfileId === 'work-login',
    ),
  );
  await page.getByRole('button', { name: 'Project personal', exact: true }).click();
  await page.waitForFunction(() =>
    window.projectFixture.calls.some((c) => c.command === 'agent_models' && c.agent === 'codex'),
  );
  assert.deepEqual(errors, []);
  console.log(
    'Project agent UI fixtures passed: scope, defaults, accounts, reload, keyboard, themes and responsive layouts.',
  );
} finally {
  await browser.close();
  await unlink(fixturePath);
}
