import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5198';
const output = 'output/playwright/project-onboarding';
await mkdir(output, { recursive: true });
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import { OnboardingFlow } from '/src/components/onboarding/OnboardingFlow.tsx';
import { ProjectOverview } from '/src/components/projects/ProjectOverview.tsx';
import { useOnboardingStore } from '/src/stores/onboardingStore.ts';
import { useExecutionStore } from '/src/stores/executionStore.ts';
import { useProjectStore } from '/src/stores/projectStore.ts';
import { useAgentAccountsStore } from '/src/stores/agentAccountsStore.ts';
import { useThemeStore } from '/src/stores/themeStore.ts';
import '/src/index.css';
const project={id:'atlas',name:'Atlas',path:'C:/Fixture/atlas',gitBranch:'main',preferences:{preferredRunner:'codex'}};
const overview=location.search.includes('overview');
const f=window.setupFixture={calls:[],finished:null,failReadiness:location.search.includes('unavailable'),pending:{},state:()=>useOnboardingStore.getState(),select:(id)=>useProjectStore.setState({activeProjectId:id}),theme:(isDark)=>useThemeStore.getState().setTheme({...useThemeStore.getState().currentTheme,appearance:'manual',isDark})};
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>0,invoke:async(command,args={})=>{
 f.calls.push({command,...args});
 if(command==='project_readiness'){
  if(overview||location.search.includes('deferred'))return new Promise((resolve,reject)=>{f.pending[args.path]={resolve:(changes,defaults={})=>resolve({head:'abcdef',branch:'main',changes,recentChanges:'',prepareCommand:null,verifyCommand:null,previewCommand:null,dependenciesMissing:false,missingConfiguration:[],notes:[],...defaults}),reject};});
  if(f.failReadiness)throw new Error('Workspace inspection unavailable.');
  return {head:'abcdef',branch:'main',changes:'',recentChanges:'',prepareCommand:'pnpm install',verifyCommand:'pnpm test',previewCommand:'pnpm dev',dependenciesMissing:true,missingConfiguration:[],notes:[]};
 }
 if(command==='project_git_policy')return args.policy||{attribution:'agent',name:'Fixture',email:'fixture@example.invalid',cleanupAfterMerge:true,autoCheckpoint:true};
 if(command==='routing_settings')return {mode:'agent',defaultMode:'agent',projectMode:null,jevFallback:'local',connected:false,hasKey:false,checkedAt:null,storageError:null,revision:0};
 if(command==='queue_snapshot')return {items:[],mergedRunIds:[]};
 return null;
}};
useProjectStore.setState({projects:overview?[project,{...project,id:'second',name:'Second',path:'C:/Fixture/second'}]:[],activeProjectId:'atlas'});
useAgentAccountsStore.setState({load:async()=>{}});
useExecutionStore.setState({runners:[{id:'codex',name:'Codex',available:true,signedIn:true,account:'fixture',detail:'Browser fixture only'}],discovering:false});
if(!useOnboardingStore.getState().pendingProject)useOnboardingStore.setState({status:'active',step:'agent',projectId:'atlas',pendingProject:project,firstTask:''});
ReactDOM.createRoot(document.getElementById('root')).render(overview?React.createElement(ProjectOverview,{onOpenProject:()=>{}}):React.createElement(OnboardingFlow,{onFinish:(agent,key)=>{f.finished={agent,key,project:useOnboardingStore.getState().pendingProject,draft:useOnboardingStore.getState().firstTask}},onSkip:()=>{f.finished={skipped:true}}}));
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
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByText('Step 2 of 6', { exact: true }).waitFor();
  assert.deepEqual(await page.locator('.onboarding-steps li strong').allTextContents(), [
    'Project',
    'Agents',
    'Decisions',
    'Behavior',
    'Appearance',
    'First task',
  ]);
  await page.waitForFunction(
    () => window.setupFixture.state().pendingProject.preferences.previewCommand === 'pnpm dev',
  );
  assert.equal(
    await page.evaluate(() => window.setupFixture.state().pendingProject.preferences.autoVerify),
    undefined,
  );
  assert.equal(
    await page.evaluate(
      () => window.setupFixture.calls.filter((call) => call.command === 'project_readiness').length,
    ),
    1,
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByText('Step 3 of 6', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByText('Step 4 of 6', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByText('Step 3 of 6', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByText('Step 4 of 6', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByText('Step 5 of 6', { exact: true }).waitFor();
  const before = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--accent-h'),
  );
  await page.getByRole('button', { name: 'Mojave Sunset', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByText('Step 4 of 6', { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent-h')),
    before,
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByText('Step 5 of 6', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByText('Step 6 of 6', { exact: true }).waitFor();
  assert.equal(await page.getByText('Workspace readiness', { exact: true }).count(), 0);
  const prompt = page.getByLabel('Your first task (optional)', { exact: true });
  await prompt.fill('Fix the empty search state and verify keyboard access.');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByText('Step 5 of 6', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  assert.equal(await prompt.inputValue(), 'Fix the empty search state and verify keyboard access.');
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await prompt.inputValue(), 'Fix the empty search state and verify keyboard access.');
  for (const [width, height] of [
    [1280, 840],
    [960, 640],
  ]) {
    await page.setViewportSize({ width, height });
    for (const dark of [true, false]) {
      await page.evaluate((dark) => window.setupFixture.theme(dark), dark);
      await page
        .waitForFunction((dark) => {
          const channel = Number(
            getComputedStyle(document.querySelector('.onboarding-intro h1')).color.match(/\d+/)[0],
          );
          return dark ? channel > 200 : channel < 80;
        }, dark)
        .catch(async (error) => {
          console.log(
            await page.evaluate(() =>
              ['html', 'body', '.onboarding-shell', '.onboarding-intro', 'h1'].map((selector) => {
                const node = document.querySelector(selector);
                const style = getComputedStyle(node);
                return {
                  selector,
                  color: style.color,
                  token: style.getPropertyValue('--color-text-primary'),
                };
              }),
            ),
          );
          throw error;
        });
      await prompt.focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Back');
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({
        path: `${output}/setup-${width}-${dark ? 'dark' : 'light'}.png`,
      });
      for (const step of [5, 4]) {
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await page.getByText(`Step ${step} of 6`, { exact: true }).waitFor();
        assert.equal(await page.locator('.onboarding-steps li').count(), 6);
        await page.screenshot({
          path: `${output}/step-${step}-${width}-${dark ? 'dark' : 'light'}.png`,
        });
      }
      for (const step of [5, 6]) {
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        await page.getByText(`Step ${step} of 6`, { exact: true }).waitFor();
      }
    }
  }
  await page.getByRole('button', { name: 'Review first task', exact: true }).click();
  await page.waitForFunction(() => !!window.setupFixture.finished);
  assert.equal(
    await page.evaluate(() => window.setupFixture.finished.project.preferences.verifyCommand),
    'pnpm test',
  );
  assert.equal(
    await page.evaluate(() =>
      window.setupFixture.calls.some((call) => call.command === 'task_start'),
    ),
    false,
  );
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${url}/?deferred`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.setupFixture.pending['C:/Fixture/atlas']);
  await page.evaluate(() => {
    const state = window.setupFixture.state();
    state.stageProject(
      {
        ...state.pendingProject,
        preferences: {
          preferredRunner: 'codex',
          verifyCommand: 'custom check',
          prepareCommand: '',
          autoVerify: false,
        },
      },
      'Keep my draft',
    );
    window.setupFixture.pending['C:/Fixture/atlas'].resolve('', {
      prepareCommand: 'pnpm install',
      verifyCommand: 'pnpm test',
      previewCommand: 'pnpm dev',
    });
  });
  await page.waitForFunction(
    () => window.setupFixture.state().pendingProject.preferences.previewCommand === 'pnpm dev',
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      preferences: window.setupFixture.state().pendingProject.preferences,
      draft: window.setupFixture.state().firstTask,
    })),
    {
      preferences: {
        preferredRunner: 'codex',
        verifyCommand: 'custom check',
        prepareCommand: '',
        autoVerify: false,
        previewCommand: 'pnpm dev',
      },
      draft: 'Keep my draft',
    },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.setupFixture.pending['C:/Fixture/atlas']);
  await page.evaluate(() => {
    const state = window.setupFixture.state();
    state.stageProject(
      {
        ...state.pendingProject,
        id: 'second',
        path: 'C:/Fixture/second',
        preferences: { preferredRunner: 'codex' },
      },
      'Second draft',
    );
  });
  await page.waitForFunction(() => !!window.setupFixture.pending['C:/Fixture/second']);
  await page.evaluate(() => {
    window.setupFixture.pending['C:/Fixture/atlas'].resolve('', { verifyCommand: 'stale check' });
    window.setupFixture.pending['C:/Fixture/second'].resolve('', {
      previewCommand: 'second preview',
    });
  });
  await page.waitForFunction(
    () =>
      window.setupFixture.state().pendingProject.preferences.previewCommand === 'second preview',
  );
  assert.equal(
    await page.evaluate(() => window.setupFixture.state().pendingProject.preferences.verifyCommand),
    undefined,
  );
  assert.equal(await page.evaluate(() => window.setupFixture.state().firstTask), 'Second draft');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.setupFixture.pending['C:/Fixture/second']);
  await page.evaluate(() => {
    window.setupFixture.state().finish();
    window.setupFixture.pending['C:/Fixture/second'].resolve('', { verifyCommand: 'late check' });
  });
  await page.getByText('Step 1 of 6', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.setupFixture.state().pendingProject), null);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${url}/?unavailable`, { waitUntil: 'domcontentloaded' });
  for (const step of [3, 4, 5, 6]) {
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByText(`Step ${step} of 6`, { exact: true }).waitFor();
  }
  await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  await page.waitForFunction(() => window.setupFixture.finished?.skipped);
  await page.goto(`${url}/?overview`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Checking repository…', { exact: true }).waitFor();
  assert.equal(await page.getByText('Working tree clean', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Setup inspected', { exact: true }).count(), 0);
  await page.evaluate(() => window.setupFixture.select('second'));
  await page.waitForFunction(() => !!window.setupFixture.pending['C:/Fixture/second']);
  await page.evaluate(() =>
    window.setupFixture.pending['C:/Fixture/second'].resolve(' M work.txt'),
  );
  await page.getByText('Uncommitted changes', { exact: true }).waitFor();
  await page.evaluate(() => window.setupFixture.pending['C:/Fixture/atlas'].resolve(''));
  assert.equal(await page.getByText('Working tree clean', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.evaluate(() =>
    window.setupFixture.pending['C:/Fixture/second'].reject(new Error('Offline fixture')),
  );
  await page.getByText('Setup unavailable', { exact: true }).waitFor();
  assert.equal(await page.getByText('Working tree clean', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Retry repository check' }).click();
  await page.evaluate(() => window.setupFixture.pending['C:/Fixture/second'].resolve(''));
  await page.getByText('Working tree clean', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Project onboarding browser checks passed: six visible steps, automatic defaults, explicit overrides, stale inspection responses, unavailable inspection, provisional settings, draft restoration, theme rollback, keyboard and narrow layouts. No native tasks launched.',
  );
} finally {
  await browser.close();
}
