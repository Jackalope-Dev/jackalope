import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5198';
const output = 'output/playwright/decisions';
await mkdir(output, { recursive: true });
const secret = 'fixture-only-typesafe-credential';
const config = {
  mode: 'agent',
  jevFallback: 'local',
  fallbacks: {},
  connected: false,
  revision: 0,
  projects: {},
};
const assistance = {
  revision: 0,
  inherited: true,
  options: {
    objective: 'quality',
    contextSelection: false,
    failureTriage: false,
    requirementCoverage: false,
    reviewPrioritization: false,
    monitorFiltering: false,
    assignmentMatching: false,
    models: [],
  },
};
const assistanceDefaults = structuredClone(assistance.options);
const assistanceProjects = {};
const assistanceView = (projectId) => ({
  revision: assistance.revision,
  inherited: Boolean(projectId && !assistanceProjects[projectId]),
  options: assistanceProjects[projectId] ?? assistanceDefaults,
});
let failOptionsSave = false;
let failConnect = true;
const calls = [];
const status = (projectId) => ({
  mode: config.projects[projectId] ?? config.mode,
  defaultMode: config.mode,
  projectMode: config.projects[projectId] ?? null,
  jevFallback: config.fallbacks[projectId] ?? config.jevFallback,
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
import '/src/index.css';
const source=await fetch('/src/components/onboarding/OnboardingFlow.tsx').then(r=>r.text());
const module=async(name)=>import(source.split('"').find(url=>url.startsWith('/src/stores/'+name+'.ts'))||'/src/stores/'+name+'.ts');
const {useOnboardingStore}=await module('onboardingStore');
const {useProjectStore}=await module('projectStore');
const {useExecutionStore}=await module('executionStore');
const {useAgentAccountsStore}=await module('agentAccountsStore');
const {useThemeStore}=await module('themeStore');
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>0,invoke:(command,args={})=>window.fixtureInvoke(command,args)};
window.fixtureTheme=(isDark)=>useThemeStore.getState().setTheme({...useThemeStore.getState().currentTheme,appearance:'manual',isDark});
const project={id:'alpha',name:'Atlas',path:'C:/Fixture/atlas',gitBranch:'main',preferences:{preferredRunner:'codex'}};
useProjectStore.setState({projects:[],activeProjectId:'alpha'});
useExecutionStore.setState({runners:[{id:'codex',name:'Codex',available:true,signedIn:true,account:'fixture',detail:'Browser fixture only'}],discovering:false});
useAgentAccountsStore.setState({load:async()=>{}});
const onboarding=location.search.includes('onboarding');
if(onboarding)useOnboardingStore.setState({status:'active',step:'routing',projectId:'alpha',pendingProject:project,routingMode:null,routingFallback:null});
const projectId=new URLSearchParams(location.search).get('project')||undefined;
ReactDOM.createRoot(document.getElementById('root')).render(onboarding?React.createElement(OnboardingFlow,{onFinish:()=>{},onSkip:()=>{}}):React.createElement('div',{style:{padding:'32px',maxWidth:'760px'}},React.createElement('h1',null,'Jackalope Decisions'),React.createElement(RoutingPreferences,{projectId})));
`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(60000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.exposeFunction('fixtureInvoke', async (command, args) => {
    calls.push({ command, ...args, key: args.key ? '[redacted]' : undefined });
    if (command === 'decision_options') return assistanceView(args.projectId);
    if (command === 'decision_options_save') {
      assert.equal(args.revision, assistance.revision);
      if (failOptionsSave) throw new Error('Decision options changed. Reload before saving.');
      if (args.options) assistanceProjects[args.projectId] = args.options;
      else delete assistanceProjects[args.projectId];
      assistance.revision++;
      return assistanceView(args.projectId);
    }
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
        if (args.mode) {
          config.projects[args.projectId] = args.mode;
          config.fallbacks[args.projectId] = args.jevFallback ?? config.jevFallback;
        } else {
          delete config.projects[args.projectId];
          delete config.fallbacks[args.projectId];
        }
      } else {
        config.mode = args.mode;
        config.jevFallback = args.jevFallback ?? config.jevFallback;
      }
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
  await page.waitForFunction(() => document.querySelector('input[value=jev]')?.checked);
  assert.equal(await jev.isChecked(), true);
  const fallback = page.getByRole('combobox', { name: 'If Jev is unavailable or uncertain' });
  assert.match(await fallback.innerText(), /Local \(default\)/);
  const information = page.getByText('More information', { exact: true });
  await information.focus();
  await page.keyboard.press('Enter');
  await page.getByText(/Potentially faster, lower-cost decisions/).waitFor();
  await page.keyboard.press('Enter');
  assert.equal(await page.getByText(/Potentially faster, lower-cost decisions/).isVisible(), false);
  assert.equal(await page.getByText(/Applies to this project/).count(), 0);
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
  assert.equal(config.fallbacks.alpha, 'local');
  await fallback.click();
  await page.getByRole('option', { name: 'Agent-powered', exact: true }).click();
  await page
    .getByText('An extra agent decision uses tokens or subscription capacity.', { exact: true })
    .waitFor();
  assert.equal(config.fallbacks.alpha, 'local');
  await page.getByRole('button', { name: 'Save routing choice' }).click();
  await page.getByText('Routing preference saved.', { exact: true }).waitFor();
  assert.equal(config.fallbacks.alpha, 'agent');
  await page.reload();
  await fallback.waitFor();
  assert.match(await fallback.innerText(), /Agent-powered/);
  assert.equal(await page.getByRole('button', { name: 'Save routing choice' }).isDisabled(), true);
  assert.equal(config.mode, 'agent');
  const assistanceSummary = page.getByText('Routing goals and optional assistance', {
    exact: true,
  });
  await assistanceSummary.focus();
  await page.keyboard.press('Enter');
  const contextHelper = page.getByRole('checkbox', { name: /^Select relevant context/ });
  assert.equal(await contextHelper.isChecked(), false);
  await contextHelper.check();
  assert.equal(assistanceProjects.alpha, undefined);
  await page.getByRole('combobox', { name: 'Routing goal' }).click();
  await page.getByRole('option', { name: 'Balanced', exact: true }).click();
  await page.getByText('Model evidence (0)', { exact: true }).click();
  await page.getByRole('button', { name: 'Add model evidence' }).click();
  const modelId = page.getByLabel('Exact model ID', { exact: true });
  await page.getByLabel('Agent adapter', { exact: true }).fill('codex');
  await modelId.pressSequentially('fixture-model');
  assert.equal(await modelId.inputValue(), 'fixture-model');
  assert.equal(await modelId.evaluate((node) => document.activeElement === node), true);
  await page
    .getByLabel('Capabilities and restrictions', { exact: true })
    .fill('Fixture evidence only');
  await page
    .getByLabel('Evidence source', { exact: true })
    .fill('fixture://independent-evaluation');
  await page.getByRole('checkbox', { name: 'medium', exact: true }).check();
  await page.getByRole('checkbox', { name: 'high', exact: true }).check();
  await page.getByRole('button', { name: 'Save decision assistance', exact: true }).click();
  await page.getByText('Decision assistance saved.', { exact: true }).waitFor();
  assert.equal(assistanceProjects.alpha.contextSelection, true);
  assert.equal(assistanceProjects.alpha.objective, 'balanced');
  assert.deepEqual(assistanceProjects.alpha.models[0].efforts, ['medium', 'high']);
  assert.equal(assistanceProjects.alpha.failureTriage, false);
  for (const [width, height] of [
    [1280, 840],
    [960, 640],
  ]) {
    await page.setViewportSize({ width, height });
    for (const dark of [true, false]) {
      await page.evaluate((dark) => window.fixtureTheme(dark), dark);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await modelId.scrollIntoViewIfNeeded();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({
        path: `${output}/${width}-${dark ? 'dark' : 'light'}-model-evidence.png`,
      });
      await assistanceSummary.evaluate((node) => node.scrollIntoView({ block: 'start' }));
      await page.screenshot({
        path: `${output}/${width}-${dark ? 'dark' : 'light'}-assistance.png`,
      });
    }
  }
  await contextHelper.uncheck();
  failOptionsSave = true;
  await page.getByRole('button', { name: 'Save decision assistance', exact: true }).click();
  await page
    .getByText('Decision options changed. Reload before saving.', { exact: false })
    .waitFor();
  failOptionsSave = false;
  await page.getByRole('button', { name: 'Reload decision options' }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('input[type=checkbox]')].some((node) => node.checked),
  );
  assert.equal(await contextHelper.isChecked(), true);
  await page.getByRole('button', { name: 'Use app assistance defaults' }).click();
  await page.getByText('Inheriting app assistance defaults.', { exact: true }).waitFor();
  assert.equal(await contextHelper.isChecked(), false);
  assert.equal(assistanceProjects.alpha, undefined);
  await page.setViewportSize({ width: 1280, height: 840 });
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
  assert.equal(config.fallbacks.beta, undefined);
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
        assert.equal(
          await page
            .locator('.routing-option-copy strong')
            .first()
            .evaluate((el) => getComputedStyle(el).alignItems),
          'baseline',
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
        if (mode === 'jev') {
          await information.scrollIntoViewIfNeeded();
          assert.equal(await fallback.isVisible(), true);
          await page.screenshot({
            path: `${output}/${width}-${dark ? 'dark' : 'light'}-jev-details.png`,
          });
        }
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
  await page.getByRole('heading', { name: 'Commits and cleanup', exact: true }).waitFor();
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
