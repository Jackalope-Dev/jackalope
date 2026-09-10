import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5191';
const output = 'output/playwright/agent-accounts';
await mkdir(output, { recursive: true });
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import { AgentAccounts } from '/src/components/agents/AgentAccounts.tsx';
import { applyThemeTokens, DEFAULT_THEME } from '/node_modules/@jackalope/brand/src/theme.ts';
import '/src/index.css';
import '/src/components/tasks/task-workspace.css';
import '/src/components/ui/experience.css';
import '/src/components/agents/agent-manager.css';
const f = window.accountFixture = {
  agent: new URLSearchParams(location.search).get('agent') ?? 'codex',
  profiles: [{ id: 'existing', name: 'Personal', group: 'personal' }],
  calls: [], outcome: 'running', failDelete: false, delayStart: false,
  theme: appearance => applyThemeTokens({ ...DEFAULT_THEME, isDark: appearance === 'dark' }),
};
window.__TAURI_INTERNALS__ = { invoke: async (command, args = {}) => {
  f.calls.push({ command, ...args });
  const profile = f.profiles.find(p => p.id === args.id);
  switch (command) {
    case 'agent_profile_list': return {
      profiles: f.profiles.filter(p => !p.pending), activeId: null,
      defaultName: 'CLI account', defaultGroup: null, defaultTag: null, envVar: 'CODEX_HOME',
    };
    case 'agent_profile_create': {
      const profile = { id: 'new', name: args.name, group: args.group, pending: args.pending };
      f.profiles.push(profile);
      return profile;
    }
    case 'agent_profile_delete':
      if (f.failDelete) throw new Error('Cleanup failed. Retry cancellation.');
      f.profiles = f.profiles.filter(p => p.id !== args.id);
      return;
    case 'agent_profile_sign_in':
      if (f.delayStart) await new Promise(resolve => setTimeout(resolve, 500));
      return 'session';
    case 'agent_profile_sign_in_poll': return {
      state: f.outcome === 'running' ? 'running' : 'exited',
      exitCode: 0, chunks: [], truncated: false,
    };
    case 'agent_profile_status': {
      const state = profile?.pending ? f.outcome === 'success' ? f.agent === 'aider' ? 'configured' : 'signedIn' : 'signedOut' : 'signedIn';
      if ((state === 'signedIn' || state === 'configured') && profile) profile.pending = false;
      return { state, identity: state === 'signedIn' ? 'sample@example.test' : null,
        detail: state === 'signedIn' ? 'Provider identity detected.' : 'Sign-in needed.', checkedAt: new Date().toISOString() };
    }
    case 'agent_profile_rename': profile.name = args.name; return;
    case 'agent_profile_set_group': profile.group = args.group; return;
    case 'agent_profile_set_tag': profile.tag = args.tag; return;
    case 'agent_profile_save_key': return;
    case 'agent_profile_sign_in_stop':
    case 'agent_profile_sign_in_resize':
    case 'agent_profile_sign_in_input':
    case 'agent_profile_set_active': return;
    default: throw new Error('Unexpected fixture command: ' + command);
  }
}};
f.theme('dark');
ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement('main', { className: 'agent-manager p-8' },
    React.createElement('p', null, 'Browser fixture only; no native sign-in or tasks launched.'),
    React.createElement(AgentAccounts, { agentId: f.agent, agentName: f.agent === 'aider' ? 'Aider' : 'Codex' })));`;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fixture }),
  );
  await page.goto(url);
  const edit = page.getByRole('button', { name: 'Edit Personal', exact: true });
  await edit.waitFor();
  for (const width of [1280, 960]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const appearance of ['light', 'dark']) {
      await page.emulateMedia({
        reducedMotion: appearance === 'light' ? 'no-preference' : 'reduce',
      });
      await page.evaluate((value) => window.accountFixture.theme(value), appearance);
      await edit.click();
      const dialog = page.getByRole('dialog', { name: 'Edit account' });
      const name = dialog.getByRole('textbox', { name: 'Account name' });
      await name.waitFor();
      assert(await name.evaluate((el) => el === document.activeElement));
      const geometry = await dialog.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const inputs = [...el.querySelectorAll('.task-input')].map((input) => {
          const r = input.getBoundingClientRect();
          const label = input.parentElement.getBoundingClientRect();
          return { x: r.x, width: r.width, height: r.height, labelWidth: label.width };
        });
        return {
          inputs,
          fits: rect.top >= 0 && rect.bottom <= innerHeight && el.scrollWidth <= el.clientWidth,
        };
      });
      assert(geometry.fits);
      for (const input of geometry.inputs) {
        assert.equal(input.width, input.labelWidth);
        assert(input.height >= 44);
      }
      assert.equal(geometry.inputs[0].x, geometry.inputs[1].x);
      await page.keyboard.press('Tab');
      assert(
        await dialog
          .getByRole('textbox', { name: 'Custom label (optional)' })
          .evaluate((el) => el === document.activeElement),
      );
      await page.keyboard.press('Tab');
      await page.keyboard.press('ArrowRight');
      assert(await dialog.getByRole('radio', { name: 'Other' }).isChecked());
      await page.screenshot({ path: `${output}/edit-${width}-${appearance}.png` });
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert(await edit.evaluate((el) => el === document.activeElement));
    }
  }
  const add = page.getByRole('button', { name: 'Add account & sign in', exact: true });
  const signIn = () => page.getByRole('dialog', { name: /Sign in to Codex/ });
  const newRow = () => page.locator('.agent-accounts-row').filter({ hasText: 'Work 2' });
  await page.evaluate(() => {
    window.accountFixture.delayStart = true;
  });
  await add.click();
  await signIn().waitFor();
  assert.equal(await newRow().count(), 0);
  await signIn().getByRole('button', { name: 'Cancel sign-in' }).click();
  await signIn().waitFor({ state: 'hidden' });
  assert.equal(await newRow().count(), 0);
  const calls = await page.evaluate(() => window.accountFixture.calls.map((call) => call.command));
  assert(calls.indexOf('agent_profile_sign_in_stop') < calls.indexOf('agent_profile_delete'));
  assert.equal(await page.evaluate(() => window.accountFixture.profiles.length), 1);

  await page.evaluate(() => {
    window.accountFixture.outcome = 'failed';
    window.accountFixture.delayStart = false;
  });
  await add.click();
  await signIn().getByRole('button', { name: 'Done', exact: true }).click();
  await signIn().waitFor({ state: 'hidden' });
  assert.equal(await newRow().count(), 0);

  await page.evaluate(() => {
    window.accountFixture.outcome = 'running';
    window.accountFixture.failDelete = true;
  });
  await add.click();
  await signIn().getByRole('button', { name: 'Cancel sign-in' }).click();
  await signIn().getByRole('alert').filter({ hasText: 'Cleanup failed' }).waitFor();
  assert.equal(await newRow().count(), 0);
  await page.evaluate(() => {
    window.accountFixture.failDelete = false;
  });
  await signIn().getByRole('button', { name: 'Done', exact: true }).click();
  await signIn().waitFor({ state: 'hidden' });

  await page.evaluate(() => {
    window.accountFixture.outcome = 'success';
  });
  await add.click();
  await signIn().getByRole('button', { name: 'Done', exact: true }).click();
  await signIn().waitFor({ state: 'hidden' });
  assert.equal(await newRow().count(), 1);
  assert.equal(
    await page.evaluate(() => window.accountFixture.profiles.find((p) => p.id === 'new').pending),
    false,
  );

  await page.evaluate(() => {
    window.accountFixture.outcome = 'running';
  });
  await newRow().getByRole('button', { name: 'Sign in', exact: true }).click();
  await signIn().getByRole('button', { name: 'Cancel sign-in' }).click();
  await signIn().waitFor({ state: 'hidden' });
  await newRow().getByRole('status').filter({ hasText: 'Signed in' }).waitFor();
  assert.equal(await newRow().count(), 1);
  await page.goto(`${url}?agent=aider`);
  const addKey = page.getByRole('button', { name: 'Add account & connect', exact: true });
  const connect = page.getByRole('dialog', { name: /Connect Aider/ });
  await addKey.click();
  await connect.getByRole('button', { name: 'Cancel', exact: true }).click();
  await connect.waitFor({ state: 'hidden' });
  assert.equal(await newRow().count(), 0);
  await addKey.click();
  await connect.getByLabel('API key', { exact: true }).fill('fixture-key');
  await connect.getByRole('button', { name: 'Connect account', exact: true }).click();
  await connect.getByRole('alert').waitFor();
  assert.equal(await newRow().count(), 0);
  await page.evaluate(() => {
    window.accountFixture.outcome = 'success';
  });
  await connect.getByLabel('API key', { exact: true }).fill('fixture-key');
  await connect.getByRole('button', { name: 'Connect account', exact: true }).click();
  await connect.waitFor({ state: 'hidden' });
  assert.equal(await newRow().count(), 1);
  assert.deepEqual(errors, []);
  await page.close();
  console.log(
    'Account fixtures passed: layout, focus, themes, sizes, reduced motion, startup cancellation, failed setup, cleanup retry, confirmed setup and existing-account cancellation. No native sign-in was performed.',
  );
} finally {
  await browser.close();
}
