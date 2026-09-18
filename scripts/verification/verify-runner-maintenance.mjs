import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const output = 'output/playwright/runner-maintenance';
await mkdir(output, { recursive: true });
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import { ManagedRuntimeSettings } from '/src/components/agents/ManagedRuntimeSettings.tsx';
import { useExecutionStore } from '/src/stores/executionStore.ts';
import { applyThemeTokens, DEFAULT_THEME } from '/node_modules/@jackalope/brand/src/theme.ts';
import '/src/index.css';
import '/src/components/tasks/task-workspace.css';
const f = window.maintenance = { calls: [], fail: false, retained: 1,
  theme: dark => applyThemeTokens({...DEFAULT_THEME,isDark:dark}) };
useExecutionStore.setState({discover:async()=>{}});
window.__TAURI_INTERNALS__ = { transformCallback:()=>0, unregisterCallback:()=>{}, invoke:async(command,args={})=>{
  f.calls.push({command,...args});
  if(command==='managed_runtime_status') return {supported:true,installed:true,installedVersion:'1.18.31',version:'1.18.31',diskBytes:190e6,source:'Jackalope private runner',detail:null};
  if(command==='managed_runtime_cleanup') { if(f.fail) throw new Error('Wait for runner setup to finish before cleaning up.'); return {removed:1,retained:f.retained}; }
  if(command==='managed_runtime_prepare') { args.progress.onmessage({phase:'ready',message:'Private runner ready',completed:0,total:null}); return; }
  throw new Error('Unexpected command '+command);
}};
f.theme(true);
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement('main',{className:'p-6'},React.createElement(ManagedRuntimeSettings)));
`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fixture }),
  );
  await page.goto(process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5191');
  const region = page.getByRole('region', { name: 'Private runner', exact: true });
  await region.getByText(/Integrity verified/).waitFor();
  for (const width of [1280, 960, 390]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const dark of [false, true]) {
      await page.evaluate((dark) => window.maintenance.theme(dark), dark);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert(await region.evaluate((el) => el.scrollWidth <= el.clientWidth));
      await region.getByRole('button', { name: 'Check & repair' }).focus();
      await page.keyboard.press('Enter');
      await page.screenshot({
        path: `${output}/${width}-${dark ? 'dark' : 'light'}.png`,
        animations: 'disabled',
      });
    }
  }
  await page.evaluate(() => {
    window.maintenance.fail = true;
  });
  await region.getByRole('button', { name: 'Clean unused versions' }).click();
  await region.getByRole('alert').filter({ hasText: 'Wait for runner setup' }).waitFor();
  await page.evaluate(() => {
    window.maintenance.fail = false;
  });
  await region.getByRole('button', { name: 'Clean unused versions' }).click();
  await region.getByRole('status').filter({ hasText: '1 runner folders removed' }).waitFor();
  await region.getByRole('button', { name: 'Remove idle runner' }).click();
  const calls = await page.evaluate(() => window.maintenance.calls);
  assert(
    calls.some(
      (call) => call.command === 'managed_runtime_prepare' && call.useConfigured === false,
    ),
  );
  assert(
    calls.some((call) => call.command === 'managed_runtime_cleanup' && call.removeActive === true),
  );
  assert.deepEqual(errors, []);
  console.log(
    'Runner maintenance fixtures passed: size/themes/focus, repair, cleanup refusal/retry and retained active versions. Native behavior is tested separately.',
  );
} finally {
  await browser.close();
}
