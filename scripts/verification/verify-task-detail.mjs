import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5188';
const output = 'output/playwright/task-detail';
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
import '/src/components/ui/experience.css';
const base = {
 id: 'sample', taskId: 'task', projectId: 'atlas', projectName: 'Atlas',
 projectPath: 'C:/Projects/atlas', workspace: 'C:/Projects/atlas-task', branch: 'task/search',
 targetBranch: 'main', baseHead: 'abc', agent: 'codex', account: 'Personal', model: 'Example model',
 prompt: 'Make search easier to use with a keyboard', status: 'running',
 startedAt: '2026-09-11T12:00:00Z', endedAt: null, sessionId: 'session', result: '',
 activity: ['Read src/search.tsx', 'Added arrow-key navigation to the search results.\\nSelection follows the focused result.', 'Running the focused search checks.'],
 diagnostics: [], error: null, persistenceError: null, exitCode: null,
 usage: { input: 1400, output: 620, cacheRead: 0, cacheWrite: 0, reported: true, estimatedCostUsd: null },
};
const f = window.taskFixture = {
 calls: [], failStop: false, integrated: false,
 theme: appearance => applyThemeTokens({ ...DEFAULT_THEME, isDark: appearance === 'dark' }),
 update: changes => useExecutionStore.setState(s => ({ runs: s.runs.map(r => r.id === s.selectedId ? {...r, ...changes} : r) })),
 scenario: (status, extra = {}) => {
   f.integrated = false;
   useExecutionStore.setState({ selectedId: 'sample', drafts: {}, runs: [{...base, status, ...extra}] });
 },
};
window.__TAURI_INTERNALS__ = { invoke: async (command, args = {}) => {
 f.calls.push({command, ...args});
 switch(command) {
  case 'task_review': return { files: [], diff: '', note: '' };
  case 'task_preview_status': return null;
  case 'task_outcome_snapshot': return 'snapshot';
  case 'mcp_list_servers': return [];
  case 'queue_snapshot': return {items: [], mergedRunIds: f.integrated ? ['sample'] : []};
  case 'integration_list': return [];
  case 'task_stop':
   if(f.failStop) throw new Error('Could not stop the agent. Try again.');
   f.update({status: 'stopped'}); return;
  case 'task_mark_reviewed': f.update({status: 'reviewed'}); return;
  case 'task_respond_prompt': f.update({prompts: []}); return true;
  default: throw new Error('Unexpected fixture command: ' + command);
 }
}};
useProjectStore.setState({projects: [{id: 'atlas', name: 'Atlas', path: base.projectPath, worktrees: []}], activeProjectId: 'atlas'});
useExecutionStore.setState({ runs: [base], selectedId: 'sample', loading: false,
 refresh: async () => {}, start: async request => { f.calls.push({command: 'continue', ...request}); return 'next'; },
});
f.theme('dark');
function Example() {
 const { runs, selectedId } = useExecutionStore();
 const run = runs.find(r => r.id === selectedId);
 return React.createElement('main', {style:{height:'100vh', display:'flex', flexDirection:'column'}},
  React.createElement('p', {style:{fontSize:12,padding:'6px 32px',color:'var(--color-text-secondary)'}}, 'Browser fixture only; no native tasks launched.'),
  React.createElement(TaskDetail, {key:run.id, run, integrated:f.integrated, onBack:()=>{}, onSchedule:()=>f.calls.push({command:'schedule'}), onCapture:()=>f.calls.push({command:'capture'})}));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Example));
`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('requestfailed', (request) =>
    console.error('Request failed:', request.url(), request.failure()),
  );
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text());
  });
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.route('**/src/main.tsx*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fixture }),
  );
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try {
    await page
      .getByRole('heading', { name: 'Make search easier to use with a keyboard' })
      .waitFor({ timeout: 30000 });
  } catch (error) {
    console.error(await page.locator('body').innerText());
    await page.screenshot({ path: `${output}/load-failure.png` });
    throw error;
  }
  assert.equal(await page.getByRole('tab').count(), 4);
  const tabs = page.getByRole('tablist', { name: 'Task sections' });
  await tabs.getByRole('tab', { name: 'Output', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page
    .locator('[role=tab][data-state=active]')
    .filter({ hasText: /^Review$/ })
    .waitFor();
  assert.equal(
    await tabs.getByRole('tab', { name: 'Review', exact: true }).getAttribute('aria-selected'),
    'true',
  );
  await tabs.getByRole('tab', { name: 'Activity', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search activity' }).fill('arrow-key');
  assert.equal(await page.locator('.task-activity-list > li').count(), 1);
  await page
    .getByText('Added arrow-key navigation to the search results.', { exact: true })
    .click();
  await page.getByText('Selection follows the focused result.', { exact: false }).waitFor();
  await page.screenshot({ path: `${output}/activity-1280-dark.png` });
  await tabs.getByRole('tab', { name: 'Output', exact: true }).click();
  const menu = page.getByRole('button', { name: 'More task actions' });
  await menu.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Task details' }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'More task actions',
  );
  const reply = page.getByRole('textbox', { name: 'Follow-up instructions' });
  await reply.fill('Also support Escape to close search.');
  await page.evaluate(() => (window.taskFixture.failStop = true));
  await page.getByRole('button', { name: 'Stop and send' }).click();
  await page.getByText('Could not stop the agent. Try again.', { exact: false }).waitFor();
  assert.equal(await reply.inputValue(), 'Also support Escape to close search.');
  assert.equal(
    await page.evaluate(
      () => window.taskFixture.calls.filter((c) => c.command === 'continue').length,
    ),
    0,
  );
  await page.evaluate(() => (window.taskFixture.failStop = false));
  await page.getByRole('button', { name: 'Stop and send' }).click();
  await page.waitForFunction(() => window.taskFixture.calls.some((c) => c.command === 'continue'));
  assert.equal(await reply.inputValue(), '');
  const continued = await page.evaluate(() =>
    window.taskFixture.calls.find((c) => c.command === 'continue'),
  );
  assert.equal(continued.previousRunId, 'sample');
  assert.equal(continued.prompt, 'Also support Escape to close search.');

  for (const width of [1280, 960]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const appearance of ['light', 'dark']) {
      await page.evaluate((value) => window.taskFixture.theme(value), appearance);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const status of ['running', 'review', 'failed', 'interrupted']) {
        await page.evaluate(
          (status) =>
            window.taskFixture.scenario(status, {
              result:
                status === 'review'
                  ? 'Search is ready for review.\n\n- Arrow keys move through results.\n- Enter opens the selected result.\n- Escape closes search.\n\nThe search suite passed; the full application still needs a manual check.'
                  : '',
              error:
                status === 'failed'
                  ? 'The agent connection closed before the task finished.\n' +
                    'Diagnostic detail: connection unavailable. '.repeat(70)
                  : null,
            }),
          status,
        );
        await tabs.getByRole('tab', { name: 'Output', exact: true }).click();
        if (status === 'review')
          await page.getByText('Search is ready for review.', { exact: true }).waitFor();
        await page.locator('.task-detail').evaluate((el) => (el.scrollTop = 0));
        if (status === 'interrupted')
          assert.equal(
            await page.getByRole('button', { name: 'Continue in a new task' }).count(),
            0,
          );
        assert(
          await page.locator('.task-detail').evaluate((el) => el.scrollWidth <= el.clientWidth),
          'Task overflow',
        );
        if (status === 'running')
          assert.equal(
            await page
              .locator('.brand-agent-character')
              .evaluate((el) => getComputedStyle(el).animationName),
            'none',
          );
        await page.screenshot({
          path: `${output}/${status}-${width}-${appearance}.png`,
        });
      }
    }
  }
  await page.evaluate(() =>
    window.taskFixture.scenario('failed', { error: 'Short failure\nLong diagnostic detail' }),
  );
  await page.getByText('Error details', { exact: true }).click();
  await page.getByText('Long diagnostic detail', { exact: false }).waitFor();
  await page.evaluate(() =>
    window.taskFixture.scenario('running', {
      prompts: [
        {
          id: 'question',
          runId: 'sample',
          question: 'Which search behavior should we use?',
          inputType: 'choice',
          options: ['Match words', 'Match exact phrase'],
          status: 'pending',
          createdAt: '2026-09-11T12:01:00Z',
        },
      ],
    }),
  );
  await page.getByText('Needs your input', { exact: true }).waitFor();
  assert.equal(await page.locator('.brand-agent-character').getAttribute('data-state'), 'waiting');
  await page.evaluate(async () => {
    const { useExecutionStore } = await import('/src/stores/executionStore.ts');
    const first = useExecutionStore.getState().runs[0];
    useExecutionStore.setState({
      runs: [
        { ...first, status: 'stopped', prompts: [] },
        { ...first, id: 'newer', startedAt: '2026-09-11T13:00:00Z' },
      ],
    });
  });
  await page.getByText('You’re viewing an earlier attempt.').waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Follow-up instructions' }).count(), 0);
  await page.getByRole('button', { name: 'Open latest result' }).click();
  await page.getByRole('textbox', { name: 'Follow-up instructions' }).waitFor();
  await page.evaluate(() =>
    window.taskFixture.scenario('review', {
      contract: {
        requirements: [
          { id: 'keys', title: 'Keyboard navigation works', checkpoint: false, receipt: null },
        ],
        inputs: {},
      },
      verificationError: 'The check command could not start.',
      validationSteps: [
        {
          id: 'manual',
          step: 'Search with arrow keys',
          status: 'passed',
          timestamp: '2026-09-11T12:02:00Z',
          notes: 'Agent observation',
          evidence: [],
        },
      ],
    }),
  );
  await tabs.getByRole('tab', { name: 'Review', exact: true }).click();
  await page.getByText('Keyboard navigation works', { exact: true }).waitFor();
  await page.getByText('Search with arrow keys', { exact: true }).waitFor();
  await page.getByText('Automatic checks could not finish:', { exact: false }).waitFor();
  await page.locator('.task-detail').evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: `${output}/review-tools-960-dark.png` });
  await tabs.getByRole('tab', { name: 'Details', exact: true }).click();
  await page.getByText('Example model', { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Instruction for this attempt' }).waitFor();
  await page.getByText('Example model', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/details-960-dark.png` });
  await page.evaluate(() => window.taskFixture.scenario('starting', { workspace: '' }));
  await tabs.getByRole('tab', { name: 'Output', exact: true }).click();
  await page.getByText('Preparing workspace', { exact: true }).waitFor();
  await page.evaluate(() => window.taskFixture.update({ status: 'stopping' }));
  assert(await page.getByRole('button', { name: 'Stop', exact: true }).isDisabled());
  await page.evaluate(() => window.taskFixture.scenario('reviewed'));
  await page.getByText('Reviewed', { exact: true }).first().waitFor();
  await page.evaluate(() => {
    window.taskFixture.integrated = true;
    window.taskFixture.update({ workspace: '' });
  });
  await page.getByRole('button', { name: 'Continue in a new task' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Follow-up instructions' }).count(), 0);
  await page.evaluate(() => window.taskFixture.scenario('running'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(
    await page
      .locator('.brand-agent-character')
      .evaluate((el) => getComputedStyle(el).animationName),
    'brand-agent-working',
  );
  await page.setViewportSize({ width: 680, height: 640 });
  assert(
    await page.locator('.task-detail').evaluate((el) => el.scrollWidth <= el.clientWidth),
    'Task overflow beside the sidebar',
  );
  assert.deepEqual(errors, []);
  console.log(
    'Task detail browser fixtures passed: states, themes, responsive layouts, reduced motion, keyboard tabs/menu, activity search, error disclosure, history and stop-before-continue recovery. No native tasks launched.',
  );
} finally {
  await browser.close();
}
