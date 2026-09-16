import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5198';
const output = 'output/playwright/decisions';
await mkdir(output, { recursive: true });
const secret = 'fixture-only-typesafe-credential';
const config = { mode: 'agent', connected: false, revision: 0, projects: {} };
let failConnect = true;
const calls = [];
const status = (projectId) => ({
  mode: config.projects[projectId] ?? config.mode,
  defaultMode: config.mode,
  projectMode: config.projects[projectId] ?? null,
  connected: config.connected,
  hasKey: config.connected,
  revision: config.revision,
  checkedAt: config.connected ? '2026-09-16T00:00:00Z' : null,
  storageError: null,
});
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import { RoutingPreferences } from '/src/components/settings/RoutingSetup.tsx';
import { OnboardingFlow } from '/src/components/onboarding/OnboardingFlow.tsx';
import { useOnboardingStore } from '/src/stores/onboardingStore.ts';
import { useProjectStore } from '/src/stores/projectStore.ts';
import { useExecutionStore } from '/src/stores/executionStore.ts';
import { useAgentAccountsStore } from '/src/stores/agentAccountsStore.ts';
import { useThemeStore } from '/src/stores/themeStore.ts';
import '/src/index.css';
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>0,invoke:(command,args={})=>window.fixtureInvoke(command,args)};
window.fixtureTheme=(isDark)=>useThemeStore.getState().setTheme({...useThemeStore.getState().currentTheme,appearance:'manual',isDark});
const project={id:'alpha',name:'Atlas',path:'C:/Fixture/atlas',gitBranch:'main',preferences:{preferredRunner:'codex'}};
useProjectStore.setState({projects:[],activeProjectId:'alpha'});
useExecutionStore.setState({runners:[{id:'codex',name:'Codex',available:true,signedIn:true,account:'fixture',detail:'Browser fixture only'}],discovering:false});
useAgentAccountsStore.setState({load:async()=>{}});
const onboarding=location.search.includes('onboarding');
if(onboarding)useOnboardingStore.setState({status:'active',step:'routing',projectId:'alpha',pendingProject:project,routingMode:null});
const projectId=new URLSearchParams(location.search).get('project')||undefined;
ReactDOM.createRoot(document.getElementById('root')).render(onboarding?React.createElement(OnboardingFlow,{onFinish:()=>{},onSkip:()=>{}}):React.createElement('div',{style:{padding:'32px',maxWidth:'760px'}},React.createElement('h1',null,'Jackalope Decisions'),React.createElement(RoutingPreferences,{projectId})));
`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.exposeFunction('fixtureInvoke', async (command, args) => {
    calls.push({ command, ...args, key: args.key ? '[redacted]' : undefined });
    if (command === 'routing_settings') return status(args.projectId);
    if (command === 'routing_connect') {
      assert.equal(args.key, secret);
      if (failConnect) throw new Error('Jev rejected this key.');
      config.connected = true;
      config.revision++;
      return status(args.projectId);
    }
    if (command === 'routing_set_mode') {
      assert.equal(args.revision, config.revision);
      if (args.projectId) {
        if (args.mode) config.projects[args.projectId] = args.mode;
        else delete config.projects[args.projectId];
      } else config.mode = args.mode;
      config.revision++;
      return status(args.projectId);
    }
    if (command === 'routing_disconnect') {
      config.connected = false;
      for (const project of Object.keys(config.projects))
        if (config.projects[project] === 'jev') config.projects[project] = 'deterministic';
      if (config.mode === 'jev') config.mode = 'deterministic';
      config.revision++;
      return status(args.projectId);
    }
    if (command === 'project_git_policy')
      return { attribution: 'agent', cleanupAfterMerge: true, autoCheckpoint: true };
    return null;
  });
  await page.route('**/src/main.tsx*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fixture }),
  );
  await page.goto(`${url}/?project=alpha`);
  const agent = page.getByRole('radio', { name: /Agent-powered/ });
  const jev = page.getByRole('radio', { name: /Jev-assisted/ });
  const local = page.getByRole('radio', { name: /Local rules/ });
  await agent.waitFor();
  await agent.focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await jev.isChecked(), true);
  assert.equal(await page.getByRole('button', { name: 'Save routing choice' }).isDisabled(), true);
  const key = page.getByLabel('TypeSafe API key', { exact: true });
  assert.equal(await key.getAttribute('type'), 'password');
  await key.fill(secret);
  await page.getByRole('button', { name: 'Connect Jev', exact: true }).click();
  await page.getByText('Jev rejected this key.', { exact: false }).waitFor();
  assert.equal(
    await page.evaluate(
      (secret) => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(secret),
      secret,
    ),
    false,
  );
  failConnect = false;
  await page.getByRole('button', { name: 'Connect Jev', exact: true }).click();
  await page.getByText('API key connected', { exact: true }).waitFor();
  assert.equal(config.mode, 'agent');
  assert.equal(config.projects.alpha, undefined);
  assert.equal(await page.locator('input[type=password]').count(), 0);
  await page.getByRole('button', { name: 'Save routing choice' }).click();
  await page.getByText('Routing preference saved.', { exact: true }).waitFor();
  assert.equal(config.projects.alpha, 'jev');
  assert.equal(config.mode, 'agent');
  await page.goto(`${url}/?project=beta`);
  await agent.waitFor();
  assert.equal(await agent.isChecked(), true);
  await local.check();
  await page.getByRole('button', { name: 'Save routing choice' }).click();
  await page.getByText('Routing preference saved.', { exact: true }).waitFor();
  assert.equal(config.projects.beta, 'deterministic');
  await page.getByRole('button', { name: 'Use app default' }).click();
  await page.getByText('Using the app default.', { exact: true }).waitFor();
  assert.equal(config.projects.beta, undefined);
  await page.goto(`${url}/?project=alpha`);
  await page.getByText('API key connected', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Replace key', exact: true }).click();
  assert.equal(await key.inputValue(), '');
  await key.fill(secret);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Remove key from this device' }).click();
  await local.waitFor();
  await page.waitForFunction(() => document.querySelector('input[value=deterministic]').checked);
  assert.equal(config.connected, false);
  assert.equal(config.projects.alpha, 'deterministic');
  await page.goto(`${url}/?onboarding`);
  await page.getByRole('heading', { name: 'Jackalope Decisions', exact: true }).waitFor();
  for (const [width, height] of [
    [1280, 840],
    [960, 640],
  ]) {
    await page.setViewportSize({ width, height });
    for (const dark of [true, false]) {
      await page.evaluate((dark) => window.fixtureTheme(dark), dark);
      for (const mode of ['deterministic', 'jev']) {
        await (mode === 'jev' ? jev : local).check();
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(
          await page
            .locator('.routing-circuit-signals')
            .evaluate((node) => getComputedStyle(node).animationName),
          'none',
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        await page
          .locator('.onboarding-content')
          .evaluate((node) => {
            node.scrollTop = 0;
          })
          .catch(() => {});
        await page.screenshot({
          path: `${output}/${width}-${dark ? 'dark' : 'light'}-${mode}.png`,
        });
      }
    }
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(
    await page
      .locator('.routing-circuit-signals')
      .evaluate((node) => getComputedStyle(node).animationIterationCount),
    '2',
  );
  await local.check();
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  assert.equal(await continueButton.isEnabled(), true);
  await continueButton.click();
  await page.getByText('Step 4 of 4', { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      (secret) => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(secret),
      secret,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  assert.equal(JSON.stringify(calls).includes(secret), false);
  console.log(
    'Decision UI checks passed: project isolation/inheritance, explicit save, key retry/replace/remove, secret-free persistence, keyboard controls, both themes/sizes and reduced motion. Native calls were fixtures.',
  );
} finally {
  await browser.close();
}
