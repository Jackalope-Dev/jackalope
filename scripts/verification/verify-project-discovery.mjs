import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

// Renders first-run setup's "We found these repositories" step and the Find projects dialog
// with a fixture scan and a fake native bridge. Nothing on this computer is scanned and no
// project is saved outside the page.
const server = process.env.JACKALOPE_PREVIEW_URL
  ? null
  : await createServer({
      root: path.resolve('apps/desktop'),
      configFile: path.resolve('apps/desktop/vite.config.ts'),
      server: { host: '127.0.0.1', port: 0 },
    });
await server?.listen();
const url =
  process.env.JACKALOPE_PREVIEW_URL ?? `http://127.0.0.1:${server.httpServer.address().port}`;
const output = 'output/playwright/project-discovery';
await mkdir(output, { recursive: true });
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import { OnboardingFlow } from '/src/components/onboarding/OnboardingFlow.tsx';
import { FindProjectsHost } from '/src/components/projects/FindProjectsDialog.tsx';
import { openProjectDiscovery } from '/src/lib/app-events.ts';
import { useOnboardingStore } from '/src/stores/onboardingStore.ts';
import { useExecutionStore } from '/src/stores/executionStore.ts';
import { useProjectStore } from '/src/stores/projectStore.ts';
import { useAgentAccountsStore } from '/src/stores/agentAccountsStore.ts';
import { useThemeStore } from '/src/stores/themeStore.ts';
import '/src/index.css';
const day=86400000, now=Date.now(), at=(days)=>new Date(now-days*day).toISOString();
const candidate=(name,extra)=>({path:'/Fixture/Code/'+name,name,hasCommits:true,lastCommitAt:at(2),remoteHost:'github.com',sessions:0,lastSessionAt:null,sources:['folders'],recommended:false,...extra});
const candidates=[
 candidate('atlas',{sessions:12,lastSessionAt:at(1),sources:['folders','sessions'],recommended:true}),
 candidate('beacon',{sessions:3,lastSessionAt:at(4),sources:['sessions'],recommended:true}),
 candidate('comet-with-a-rather-long-repository-name-for-narrow-layouts',{hasCommits:false,lastCommitAt:null,remoteHost:null,sources:['editor']}),
];
const f=window.discoveryFixture={calls:[],finished:null,open:openProjectDiscovery,state:()=>useOnboardingStore.getState(),projects:()=>useProjectStore.getState().projects,theme:(isDark)=>useThemeStore.getState().setTheme({...useThemeStore.getState().currentTheme,appearance:'manual',isDark})};
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>0,invoke:async(command,args={})=>{
 f.calls.push({command,...args});
 if(command==='project_discovery_scan'){
  if(location.search.includes('slow'))await new Promise((resolve)=>setTimeout(resolve,1500));
  return {candidates:candidates.filter((item)=>!useProjectStore.getState().projects.some((project)=>project.path===item.path)),truncated:false};
 }
 if(command==='task_pick_project')return '/Fixture/elsewhere/manual';
 if(command==='task_validate_project')return {path:args.path,name:args.path.split('/').pop(),branch:'main',repository:true};
 if(command==='project_readiness')return {head:'abcdef',branch:'main',changes:'',recentChanges:'',prepareCommand:'pnpm install',verifyCommand:'pnpm test',previewCommand:null,dependenciesMissing:false,missingConfiguration:[],notes:[]};
 if(command==='project_git_policy')return args.policy||{attribution:'agent',name:'Fixture',email:'fixture@example.invalid',cleanupAfterMerge:true,autoCheckpoint:true};
 if(command==='routing_settings')return {mode:'agent',defaultMode:'agent',projectMode:null,jevFallback:'local',connected:false,hasKey:false,checkedAt:null,storageError:null,revision:0};
 if(command==='system_detect_env_keys')return [];
 if(command==='queue_snapshot')return {items:[],mergedRunIds:[],enabledProjects:[]};
 if(command==='project_registry_list')return [];
 return null;
}};
const dialog=location.search.includes('dialog');
useProjectStore.setState({projects:dialog?[{id:'existing',name:'Existing',path:'/Fixture/Code/atlas',gitBranch:'main',worktrees:[]}]:[],activeProjectId:dialog?'existing':null});
useAgentAccountsStore.setState({load:async()=>{}});
useExecutionStore.setState({runners:[{id:'codex',name:'Codex',available:true,signedIn:true,account:'fixture',detail:'Browser fixture only'}],discovering:false,discover:async()=>{}});
useOnboardingStore.setState({status:'active',step:'project',projectId:null,pendingProject:null,firstTask:null});
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,
 React.createElement('p',{style:{position:'fixed',bottom:0,right:4,zIndex:90,fontSize:10,pointerEvents:'none'}},'Browser fixture only; no native execution'),
 dialog?React.createElement('main',null,React.createElement(FindProjectsHost)):React.createElement(OnboardingFlow,{onFinish:()=>{},onSkip:()=>{}})));
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
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // While the scan runs, setup says so and can move on to choosing a folder.
  await page.goto(`${url}/?slow`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('heading', { name: 'Looking for your repositories' }).waitFor();
  await page.getByRole('button', { name: 'Choose a folder instead' }).waitFor();
  await page.getByRole('heading', { name: 'We found these repositories' }).waitFor();

  // The recommended ones start chosen; keyboard toggles a row.
  const choices = page.getByRole('group', { name: 'Repositories to add as projects' });
  const atlas = choices.getByRole('checkbox', { name: /atlas/ });
  const comet = choices.getByRole('checkbox', { name: /comet/ });
  assert.ok(await atlas.isChecked());
  assert.ok(!(await comet.isChecked()));
  await choices.getByText('12 agent conversations').waitFor();
  await choices.getByText('No commits yet').waitFor();
  await comet.focus();
  await page.keyboard.press('Space');
  assert.ok(await comet.isChecked());
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Add 2 projects' }).waitFor();

  // Another folder joins the list, chosen.
  await page.getByRole('button', { name: 'Add another folder…' }).click();
  await choices.getByRole('checkbox', { name: /manual/ }).waitFor();
  assert.ok(await choices.getByRole('checkbox', { name: /manual/ }).isChecked());
  for (const width of [1280, 960, 680]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const dark of [false, true]) {
      await page.evaluate((value) => window.discoveryFixture.theme(value), dark);
      const overflow = await page.evaluate(() => {
        const content = document.querySelector('.onboarding-content');
        return content.scrollWidth - content.clientWidth;
      });
      assert.ok(overflow <= 1, `Horizontal overflow at ${width}px: ${overflow}`);
      await page.screenshot({ path: `${output}/step-${width}-${dark ? 'dark' : 'light'}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.evaluate(() => window.discoveryFixture.theme(false));

  // Adding stages the first for the rest of setup and adds the others with their commands.
  await page.getByRole('button', { name: 'Add 3 projects' }).click();
  await page
    .getByRole('heading', { name: 'Choose agents for this project', exact: true })
    .waitFor();
  const staged = await page.evaluate(() => window.discoveryFixture.state().pendingProject);
  assert.equal(staged.path, '/Fixture/Code/atlas');
  const added = await page.evaluate(() =>
    window.discoveryFixture.projects().map((project) => ({
      path: project.path,
      verify: project.preferences?.verifyCommand,
    })),
  );
  assert.deepEqual(added, [
    { path: '/Fixture/Code/beacon', verify: 'pnpm test' },
    { path: '/Fixture/elsewhere/manual', verify: 'pnpm test' },
  ]);

  // Skipping goes to the folder picker.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('heading', { name: 'We found these repositories' }).waitFor();
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('heading', { name: 'Choose a project' }).waitFor();

  // Command search's dialog lists repositories that are not projects yet.
  await page.goto(`${url}/?dialog`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => window.discoveryFixture.open());
  const dialog = page.getByRole('dialog', { name: 'Find projects on this computer' });
  await dialog.waitFor();
  await dialog.getByRole('checkbox', { name: /beacon/ }).waitFor();
  assert.equal(await dialog.getByRole('checkbox', { name: /atlas/ }).count(), 0);
  for (const dark of [false, true]) {
    await page.evaluate((value) => window.discoveryFixture.theme(value), dark);
    await page.screenshot({ path: `${output}/dialog-${dark ? 'dark' : 'light'}.png` });
  }
  await dialog.getByRole('button', { name: 'Add project' }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.ok(
    await page.evaluate(() =>
      window.discoveryFixture.projects().some((project) => project.path === '/Fixture/Code/beacon'),
    ),
  );
  assert.equal(
    await page.evaluate(() => window.discoveryFixture.projects().length),
    2,
    'only the chosen repository was added',
  );
  assert.deepEqual(errors, []);
  console.log('Project discovery fixture passed; screenshots in', output);
} finally {
  await browser.close();
  await server?.close();
}
