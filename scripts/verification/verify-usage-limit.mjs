import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Browser fixture for the usage-limit banner on a task: fake IPC, no native tasks launched.
const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5188';
const output = 'output/playwright/usage-limit';
await mkdir(output, { recursive: true });
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import { TaskDetail } from '/src/components/tasks/TaskDetail.tsx';
import { useExecutionStore } from '/src/stores/executionStore.ts';
import { useProjectStore } from '/src/stores/projectStore.ts';
import { applyThemeTokens, DEFAULT_THEME } from '/node_modules/@jackalope/brand/src/theme.ts';
import '/src/index.css';
import '/src/components/tasks/task-workspace.css';
import '/src/components/tasks/core-workflow.css';
const resets = Math.floor(Date.now() / 1000) + 3600;
const base = {
 id: 'limited', taskId: 'task', projectId: 'atlas', projectName: 'Atlas',
 projectPath: '/Projects/atlas', workspace: '/Projects/atlas/.worktrees/search', branch: 'jackalope/search',
 targetBranch: 'main', baseHead: 'abc', agent: 'claude', account: 'Work', model: null,
 accountBinding: { adapter: 'claude', profileId: 'work', directory: '/profiles/work', label: 'Work' },
 prompt: 'Make search easier to use with a keyboard', status: 'failed',
 startedAt: new Date(Date.now() - 600000).toISOString(), endedAt: new Date(Date.now() - 60000).toISOString(),
 sessionId: 'session', result: '', activity: ['Read src/search.tsx'], diagnostics: [],
 error: "Claude AI usage limit reached|" + resets, failureKind: 'quota_exhausted',
 quotaFailure: { modelOnly: false, message: "Claude's five-hour usage limit is used up.", resetsAt: resets },
 persistenceError: null, exitCode: 1,
 usage: { input: 1400, output: 620, cacheRead: 0, cacheWrite: 0, reported: true, estimatedCostUsd: null },
};
const f = window.limitFixture = {
 calls: [],
 theme: appearance => applyThemeTokens({ ...DEFAULT_THEME, isDark: appearance === 'dark' }),
 update: changes => useExecutionStore.setState(s => ({ runs: s.runs.map(r => r.id === 'limited' ? {...r, ...changes} : r) })),
 scenario: (extra = {}) => useExecutionStore.setState({ selectedId: 'limited', runs: [{...base, ...extra}] }),
};
window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 0, unregisterCallback: () => {}, invoke: async (command, args = {}) => {
 f.calls.push({command, ...args});
 switch(command) {
  case 'task_resume_at_reset':
   f.update({ resumeAtReset: args.schedule ? { at: resets } : null }); return;
  case 'task_retry': return 'limited';
  case 'agent_profile_list': return { profiles: [{ id: 'work', name: 'Work' }, { id: 'personal', name: 'Personal' }], activeId: 'work', envVar: null, defaultName: 'CLI account' };
  case 'agent_profile_status': return { state: 'signedIn', identity: null, detail: '', checkedAt: new Date().toISOString() };
  case 'task_followup_snapshot': return [];
  case 'task_usefulness': return null;
  case 'task_preview_status': return null;
  case 'mcp_list_servers': return [];
  case 'agent_models': return {models:[],source:'fixture',account:null,checkedAt:'now',detail:'Browser fixture'};
  case 'project_readiness': return {head:'head',branch:'main',changes:'',recentChanges:'',prepareCommand:null,verifyCommand:null,previewCommand:null,dependenciesMissing:false,missingConfiguration:[],notes:[]};
  case 'queue_snapshot': return {items: [], mergedRunIds: []};
  case 'integration_plans': return [];
  case 'integration_list': return [];
  case 'task_review': return { files: [], diff: '', note: '' };
  case 'task_change_stats': return {};
  default: return null;
 }
}};
const runner = (id, name) => ({ id, name, available: true, signedIn: true, account: '', detail: '', ready: true });
useProjectStore.setState({projects: [{id: 'atlas', name: 'Atlas', path: base.projectPath, worktrees: []}], activeProjectId: 'atlas'});
useExecutionStore.setState({ runs: [base], selectedId: 'limited', loading: false,
 runners: [runner('claude', 'Claude Code'), runner('codex', 'Codex')], refresh: async () => {} });
f.theme('dark');
function Example() {
 const { runs, selectedId } = useExecutionStore();
 const run = runs.find(r => r.id === selectedId);
 return React.createElement('main', {style:{height:'100vh', display:'flex', flexDirection:'column'}},
  React.createElement(TaskDetail, {key:run.id, run, integrated:false, onBack:()=>{}}));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Example));
`;
const channel = process.platform === 'win32' ? 'msedge' : 'chrome';
const browser = await chromium.launch({ channel, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/src/main.tsx*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fixture }),
  );
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const banner = page.getByRole('region', { name: 'Usage limit reached' });
  await banner.waitFor({ timeout: 30000 });
  assert.match(await banner.innerText(), /Usage limit reached on Claude Code · Work/);
  assert.match(await banner.innerText(), /Resets .+ · in (59m|1h)/);
  const before = await banner.locator('.usage-limit-countdown').innerText();
  await page.waitForTimeout(1500);
  assert.notEqual(await banner.locator('.usage-limit-countdown').innerText(), before);
  // The provider's own text stays behind its toggle.
  await banner.getByText('Provider message').click();
  assert.match(await banner.locator('.usage-limit-message').innerText(), /usage limit reached\|/);
  await page.screenshot({ path: `${output}/dark-1280.png` });

  // Keyboard: schedule, then cancel, the resume at reset.
  const resume = banner.getByRole('button', { name: 'Resume at reset' });
  await resume.focus();
  assert.equal(
    await resume.evaluate((node) => node === document.activeElement),
    true,
    'Resume at reset takes focus',
  );
  await page.keyboard.press('Enter');
  await banner.getByText(/Resumes once the limit resets at/).waitFor();
  await page.evaluate(() => window.limitFixture.calls.length);
  const cancel = banner.getByRole('button', { name: 'Cancel resume' });
  await cancel.focus();
  await page.keyboard.press('Enter');
  await resume.waitFor();
  const scheduled = await page.evaluate(() =>
    window.limitFixture.calls.filter((call) => call.command === 'task_resume_at_reset'),
  );
  assert.deepEqual(
    scheduled.map((call) => call.schedule),
    [true, false],
  );

  // Switching moves the work to another account through the quota-handoff retry.
  await banner.getByRole('button', { name: 'Switch account' }).focus();
  await page.keyboard.press('Enter');
  const personal = page.getByRole('menuitem', { name: 'Personal' });
  await personal.waitFor();
  assert.equal(await page.getByRole('menuitem', { name: 'Work' }).count(), 0);
  await page.keyboard.press('Escape');
  await banner.getByRole('button', { name: 'Switch account' }).click();
  await page.getByRole('menuitem', { name: 'Personal' }).click();
  await banner.getByRole('button', { name: 'Switch agent' }).click();
  await page.getByRole('menuitem', { name: 'Codex' }).click();
  const retries = await page.evaluate(() =>
    window.limitFixture.calls.filter((call) => call.command === 'task_retry'),
  );
  assert.deepEqual(
    retries.map((call) => call.switchTo),
    [
      { agent: 'claude', profileId: 'personal' },
      { agent: 'codex', profileId: null },
    ],
  );

  // Light theme, narrow window and reduced motion.
  await page.evaluate(() => window.limitFixture.theme('light'));
  await page.screenshot({ path: `${output}/light-1280.png` });
  await page.setViewportSize({ width: 960, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const box = await banner.boundingBox();
  assert.ok(box && box.width <= 960, 'The banner fits a narrow window');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  assert.equal(overflow, false, 'No horizontal scroll at 960 by 640');
  await page.screenshot({ path: `${output}/light-960.png` });

  // Without a reported reset there is nothing to schedule.
  await page.evaluate(() =>
    window.limitFixture.scenario({
      quotaFailure: { modelOnly: false, message: 'You have hit your usage limit.' },
      error: 'You have hit your usage limit.',
    }),
  );
  await banner.getByText('Reset time not reported.').waitFor();
  assert.equal(await banner.getByRole('button', { name: 'Resume at reset' }).count(), 0);

  // Dismiss falls back to the ordinary failure notice with its retry.
  await banner.getByRole('button', { name: 'Dismiss' }).click();
  await banner.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Retry' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Usage-limit banner fixture passed.');
} finally {
  await browser.close();
}
