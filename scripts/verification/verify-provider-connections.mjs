import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5191';
const output = 'output/playwright/provider-connections';
await mkdir(output, { recursive: true });
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import { ProviderConnections } from '/src/components/agents/ProviderConnections.tsx';
import { useExecutionStore } from '/src/stores/executionStore.ts';
import { useAgentConfigStore } from '/src/stores/agentConfigStore.ts';
import { applyThemeTokens, DEFAULT_THEME } from '/node_modules/@jackalope/brand/src/theme.ts';
import '/src/index.css';
import '/src/components/tasks/task-workspace.css';
import '/src/components/ui/experience.css';
const f = window.providerFixture = {
  profiles: [], calls: [], failModels: false, failDelete: false, activeId: null, failRunner: false, delayRunner: false,
  options: () => useAgentConfigStore.getState().runnerOptions,
  theme: isDark => applyThemeTokens({ ...DEFAULT_THEME, isDark }),
};
useExecutionStore.setState({ runners: [{id:'opencode',available:false}], discover: async () => {} });
window.__TAURI_INTERNALS__ = { transformCallback: () => 0, unregisterCallback: () => {}, invoke: async (command, args = {}) => {
  f.calls.push({ command, ...args, ...(command === 'agent_profile_save_key' ? {value:'[redacted]'} : {}) });
  switch (command) {
    case 'managed_runtime_prepare':
      if (f.failRunner) throw new Error('Runner integrity check failed. Retry the download.');
      args.progress.onmessage({phase:'download',message:'Downloading the private OpenCode runner',completed:30000000,total:60000000});
      if (f.delayRunner) return new Promise((resolve, reject) => { f.cancelRunner = reject; f.runnerOperation = args.operationId; });
      return;
    case 'managed_runtime_cancel':
      if (args.operationId === f.runnerOperation) f.cancelRunner(new Error('Runner setup canceled. You can retry when ready.'));
      return;
    case 'agent_profile_create': {
      const profile = { id: crypto.randomUUID(), name: args.name, pending: true };
      f.profiles.push(profile); return profile;
    }
    case 'agent_profile_save_key': return;
    case 'agent_models':
      if (f.failModels) throw new Error('Model discovery unavailable.');
      return { models: [
        {id:'deepseek/flash',name:'DeepSeek Flash',isDefault:true},
        {id:'deepseek/pro',name:'DeepSeek Pro',isDefault:false},
        {id:'unrelated/other',name:'Unrelated',isDefault:false},
      ], source:'opencode' };
    case 'agent_profile_status':
      f.profiles.find(profile => profile.id === args.id).pending = false;
      return {state:'configured',identity:null,detail:'Saved, not validated.',checkedAt:new Date().toISOString()};
    case 'agent_profile_set_active': f.activeId = args.id; return;
    case 'agent_save_policy': return;
    case 'agent_profile_list': return { profiles:f.profiles.filter(p => !p.pending), activeId:f.activeId, envVar:'XDG_DATA_HOME' };
    case 'agent_profile_delete':
      if (f.failDelete) throw new Error('Cleanup failed. Retry cancellation.');
      f.profiles = f.profiles.filter(p => p.id !== args.id); return;
    default: throw new Error('Unexpected fixture command: ' + command);
  }
}};
f.theme(true);
ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement('main', {className:'p-6'}, React.createElement(ProviderConnections)));
`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fixture }),
  );
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const open = page.getByRole('button', { name: 'DeepSeek', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Connect DeepSeek', exact: true });
  await open.waitFor();
  assert.equal(
    await page.getByRole('region', { name: 'Connect an API provider' }).getByRole('button').count(),
    8,
  );
  for (const width of [1280, 960, 390]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const dark of [false, true]) {
      await page.emulateMedia({ reducedMotion: dark ? 'reduce' : 'no-preference' });
      await page.evaluate((dark) => window.providerFixture.theme(dark), dark);
      await open.focus();
      await page.keyboard.press('Enter');
      const name = dialog.getByLabel('Account name', { exact: true });
      await name.waitFor();
      assert(await name.evaluate((el) => el === document.activeElement));
      await page.keyboard.press('Tab');
      assert(
        await dialog
          .getByLabel('API key', { exact: true })
          .evaluate((el) => el === document.activeElement && el.type === 'password'),
      );
      const fits = await dialog.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.left >= 0 &&
          r.right <= innerWidth &&
          r.top >= 0 &&
          r.bottom <= innerHeight &&
          el.scrollWidth <= el.clientWidth
        );
      });
      assert(fits, `Dialog overflow at ${width}, dark=${dark}`);
      await page.screenshot({ path: `${output}/connect-${width}-${dark ? 'dark' : 'light'}.png` });
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert(await open.evaluate((el) => el === document.activeElement));
    }
  }
  await page.setViewportSize({ width: 960, height: 640 });
  await open.click();
  await dialog.getByLabel('API key', { exact: true }).fill('fixture-never-a-real-key');
  await page.evaluate(() => {
    window.providerFixture.failRunner = true;
  });
  await dialog.getByRole('button', { name: 'Save key & find models' }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Runner integrity check failed' }).waitFor();
  assert.equal(await page.evaluate(() => window.providerFixture.profiles.length), 0);
  assert.equal(
    await dialog.getByLabel('API key', { exact: true }).inputValue(),
    'fixture-never-a-real-key',
  );
  await page.evaluate(() => {
    window.providerFixture.failRunner = false;
    window.providerFixture.delayRunner = true;
  });
  await dialog.getByRole('button', { name: 'Save key & find models' }).click();
  await dialog.getByRole('progressbar', { name: 'Runner download' }).waitFor();
  assert.equal(await dialog.getByRole('progressbar').getAttribute('value'), '50');
  await page.screenshot({ path: `${output}/download-960-dark.png` });
  await dialog.getByRole('button', { name: 'Cancel runner setup' }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Runner setup canceled' }).waitFor();
  assert.equal(await page.evaluate(() => window.providerFixture.profiles.length), 0);
  await page.evaluate(() => {
    window.providerFixture.delayRunner = false;
    window.providerFixture.failModels = true;
  });
  await dialog.getByRole('button', { name: 'Save key & find models' }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Model discovery unavailable' }).waitFor();
  assert.equal(await dialog.locator('input[type=password]').count(), 0);
  await page.evaluate(() => {
    window.providerFixture.failDelete = true;
  });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Cleanup failed' }).waitFor();
  await page.evaluate(() => {
    window.providerFixture.failDelete = false;
  });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.providerFixture.profiles.length), 0);
  await page.evaluate(() => {
    window.providerFixture.failModels = false;
  });
  await open.click();
  await dialog.getByLabel('API key', { exact: true }).fill('fixture-never-a-real-key');
  await dialog.getByRole('button', { name: 'Save key & find models' }).click();
  await dialog.getByRole('combobox', { name: 'Provider model' }).click();
  assert.equal(await page.getByRole('option', { name: 'Unrelated' }).count(), 0);
  await page.getByRole('option', { name: 'DeepSeek Pro', exact: true }).click();
  assert.equal(await page.evaluate(() => window.providerFixture.activeId), null);
  await dialog.getByRole('checkbox').check();
  await page.screenshot({ path: `${output}/model-960-dark.png` });
  await dialog.getByRole('button', { name: 'Finish connection' }).click();
  await dialog.waitFor({ state: 'hidden' });
  const state = await page.evaluate(() => ({
    profiles: window.providerFixture.profiles,
    activeId: window.providerFixture.activeId,
    options: window.providerFixture.options(),
    calls: window.providerFixture.calls,
    storage: JSON.stringify(localStorage),
  }));
  assert.equal(state.profiles.length, 1);
  assert.equal(state.profiles[0].pending, false);
  assert.equal(state.activeId, state.profiles[0].id);
  assert.equal(state.options.opencode.defaultModel, 'deepseek/pro');
  assert.equal(state.calls.filter((call) => call.command === 'agent_profile_save_key').length, 2);
  assert.ok(
    state.calls.findIndex((call) => call.command === 'managed_runtime_prepare') <
      state.calls.findIndex((call) => call.command === 'agent_profile_create'),
  );
  assert.ok(
    state.calls
      .filter((call) => call.command === 'agent_profile_save_key')
      .every((call) => call.name === 'DEEPSEEK_API_KEY'),
  );
  assert.ok(!state.storage.includes('fixture-never-a-real-key'));
  assert.deepEqual(errors, []);
  console.log(
    'Provider connection fixtures passed: keyboard/focus, 3 sizes, themes, reduced motion, missing CLI, download progress, integrity retry, owned cancellation before key storage, discovery retry, profile cleanup, provider filtering, explicit default and no key in browser persistence. No live authentication performed.',
  );
} finally {
  await browser.close();
}
