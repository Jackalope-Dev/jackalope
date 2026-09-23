import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const output = 'output/playwright/private-runner-setup';
await mkdir(output, { recursive: true });
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import { LocalAiSetup } from '/src/components/agents/LocalAiSetup.tsx';
import { applyThemeTokens, DEFAULT_THEME } from '/node_modules/@jackalope/brand/src/theme.ts';
import '/src/index.css';
import '/src/components/tasks/task-workspace.css';
import '/src/components/ui/experience.css';
const f = window.runnerFixture = { calls: [], theme: dark => applyThemeTokens({...DEFAULT_THEME,isDark:dark}) };
const inspection = {hardware:{os:'macos',arch:'aarch64',memoryBytes:32*1024**3,availableMemoryBytes:24*1024**3,freeDiskBytes:100e9,gpu:'Fixture',diskLocation:null},models:[{id:'qwen3.5:4b',name:'Fixture model',downloadBytes:3.4e9,recommendedMemoryGb:16,description:'Fixture only'}],installedModels:['qwen3.5:4b'],ollamaOnline:true,opencodeInstalled:false,canInstall:false,canPrepareRunner:true,runtimeDiskBytes:4e9,catalogCheckedAt:'fixture'};
window.__TAURI_INTERNALS__ = {transformCallback:()=>0,unregisterCallback:()=>{},invoke:async(command,args={})=>{
  f.calls.push(command);
  if(command==='local_ai_inspect') return {...inspection};
  if(command==='managed_runtime_prepare') {
    if(args.useConfigured !== false) throw new Error('Local setup must prepare its private runner even when an API task has a custom executable.');
    args.progress.onmessage({phase:'download',message:'Downloading the private OpenCode runner',completed:30e6,total:60e6});
    return new Promise((resolve,reject)=>{ f.operation=args.operationId; f.cancel=()=>reject(new Error('Runner setup canceled.')); f.finish=()=>{inspection.opencodeInstalled=true;resolve();}; });
  }
  if(command==='managed_runtime_cancel') { if(args.operationId===f.operation) f.cancel(); return; }
  if(command==='local_ai_cancel') return;
  throw new Error('Unexpected fixture command: '+command);
}};
f.theme(true);
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement('main',{className:'p-6'},React.createElement(LocalAiSetup)));
`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fixture }),
  );
  await page.goto(process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5191', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.getByRole('button', { name: /Try a local agent/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Choose a model', exact: true }).click();
  await dialog.getByRole('button', { name: 'Review setup' }).click();
  const prepare = dialog.getByRole('button', { name: 'Prepare runner' });
  await prepare.click();
  await dialog.getByRole('progressbar').waitFor();
  for (const width of [1280, 960, 390]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const dark of [false, true]) {
      await page.evaluate((dark) => window.runnerFixture.theme(dark), dark);
      await page.emulateMedia({ reducedMotion: dark ? 'reduce' : 'no-preference' });
      assert(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth));
      await page.screenshot({
        path: `${output}/local-${width}-${dark ? 'dark' : 'light'}.png`,
        animations: 'disabled',
      });
    }
  }
  await dialog.getByRole('button', { name: /Stop/ }).click();
  await dialog.getByText('Error: Runner setup canceled.', { exact: true }).waitFor();
  await prepare.click();
  await dialog.getByRole('progressbar').waitFor();
  await page.evaluate(() => window.runnerFixture.finish());
  await dialog.getByRole('button', { name: 'Check connection' }).click();
  await dialog.getByRole('button', { name: 'Run local check' }).waitFor();
  assert(!(await page.evaluate(() => window.runnerFixture.calls)).includes('local_ai_install'));
  assert.deepEqual(errors, []);
  console.log(
    'Private local-runner fixture passed: non-Windows setup, 3 sizes, themes, reduced motion, progress, cancellation, retry and connection-check gating. No model or native installer ran.',
  );
} finally {
  await browser.close();
}
