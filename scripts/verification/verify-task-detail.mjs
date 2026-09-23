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
 codexSpeed: 'fast', requestedServiceTier: 'fast',
 efficiency: {timings: {workspace: {calls: 1, totalMs: 1500, maxMs: 1500}, verificationWait: {calls: 1, totalMs: 2000, maxMs: 2000}}, firstActivityMs: 2500, preparationReuses: 1, verificationReuses: 2},
};
const f = window.taskFixture = {
 calls: [], failStop: false, integrated: false, followups: [],
 theme: appearance => applyThemeTokens({ ...DEFAULT_THEME, isDark: appearance === 'dark' }),
 update: changes => useExecutionStore.setState(s => ({ runs: s.runs.map(r => r.id === s.selectedId ? {...r, ...changes} : r) })),
 scenario: (status, extra = {}) => {
   f.integrated = false;
   f.followups = [];
   useExecutionStore.setState({ selectedId: 'sample', drafts: {}, runs: [{...base, status, ...extra}] });
 },
};
window.__TAURI_INTERNALS__ = { invoke: async (command, args = {}) => {
 f.calls.push({command, ...args});
 switch(command) {
  case 'task_followup_snapshot': return structuredClone(f.followups);
  case 'task_followup_queue':
   if(f.failStop) throw new Error('Could not save the follow-up. Try again.');
   if(!f.followups.some(item => item.id === args.id)) f.followups.push({id:args.id,taskId:'task',previousRunId:args.runId,prompt:args.prompt,runId:null,paused:false,error:null});
   if(args.interrupt) f.update({status:'stopping'});
   return;
  case 'task_followup_action':
   if(args.action==='cancel') f.followups=f.followups.filter(item=>item.id!==args.id);
   else f.followups=f.followups.map(item=>item.id===args.id?{...item,paused:false,error:null}:item);
   return;
  case 'task_review': return f.review ?? { files: ['src/search.ts'], diff: 'diff --git a/src/search.ts b/src/search.ts\\n--- a/src/search.ts\\n+++ b/src/search.ts\\n@@ -1 +1 @@\\n-export const keyboard = false;\\n+export const keyboard = true;\\n', note: 'Changes in this task workspace.' };
  case 'task_usefulness': return null;
  case 'task_preview_status': return null;
  case 'task_outcome_snapshot': return f.tree ?? 'snapshot';
  case 'task_outcome_review':
   if(args.review.expectedTree !== (f.tree ?? 'snapshot')) throw new Error('Files changed while you were reviewing.');
   { const run=useExecutionStore.getState().runs[0]; f.update({contract:{...run.contract,requirements:run.contract.requirements.map(item=>item.id===args.review.requirementId?{...item,receipt:{accepted:args.review.accepted,tree:args.review.expectedTree,note:args.review.note,evidence:args.review.evidence}}:item)}}); }
   return;
  case 'mcp_list_servers': return [];
  case 'agent_models': return {models:[],source:'fixture',account:null,checkedAt:'now',detail:'Browser fixture'};
  case 'project_readiness': return {head:'head',branch:'main',changes:'',recentChanges:'',prepareCommand:null,verifyCommand:null,previewCommand:null,dependenciesMissing:false,missingConfiguration:[],notes:[]};
  case 'queue_snapshot': return {items: [], mergedRunIds: f.integrated ? ['sample'] : []};
  case 'integration_plans': return [];
  case 'integration_list': return [];
  case 'task_stop':
   if(f.failStop) throw new Error('Could not stop the agent. Try again.');
   f.update({status: 'stopped'}); return;
  case 'task_mark_reviewed': f.update({status: 'reviewed'}); return;
  case 'task_retry':
   useExecutionStore.setState(s => ({ runs: [...s.runs, {...base, id: 'retry-attempt', status: 'starting',
    retryOf: args.id, workspace: base.workspace, activity: [], result: '', error: null,
    progress: {step:'workspace', label:'Preparing the workspace', detail:'', startedAt:new Date().toISOString(), attempt:1}}] }));
   return 'retry-attempt';
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
  await tabs.getByRole('tab', { name: 'Result', exact: true }).focus();
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
    .getByRole('region', { name: 'Task activity', exact: true })
    .getByText('Added arrow-key navigation to the search results.', { exact: true })
    .click();
  await page.getByText('Selection follows the focused result.', { exact: false }).waitFor();
  await page.screenshot({ path: `${output}/activity-1280-dark.png` });
  await tabs.getByRole('tab', { name: 'Result', exact: true }).click();
  const menu = page.getByRole('button', { name: 'More task actions' });
  await menu.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Task details' }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'More task actions',
  );
  await menu.click();
  await page.getByRole('menuitem', { name: 'Task details' }).click();
  await page.getByText('Provider confirmation is unavailable.', { exact: false }).waitFor();
  await page.getByText('Execution timing', { exact: true }).click();
  await page.getByText('Waiting for check capacity', { exact: true }).waitFor();
  await page.getByText('Completed setup reused', { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/execution-timing-1280-dark.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const reply = page.getByRole('textbox', { name: 'Follow-up instructions' });
  await reply.fill('Also support Escape to close search.');
  await page.evaluate(() => (window.taskFixture.failStop = true));
  await page.getByRole('button', { name: 'Queue follow-up' }).click();
  await page.getByText('Could not save the follow-up. Try again.', { exact: false }).waitFor();
  assert.equal(await reply.inputValue(), 'Also support Escape to close search.');
  assert.equal(
    await page.evaluate(
      () => window.taskFixture.calls.filter((c) => c.command === 'continue').length,
    ),
    0,
  );
  await page.evaluate(() => (window.taskFixture.failStop = false));
  await page.getByRole('button', { name: 'Queue follow-up' }).click();
  await page.getByRole('list', { name: 'Queued follow-ups' }).waitFor();
  assert.equal(await reply.inputValue(), '');
  const continued = await page.evaluate(() =>
    window.taskFixture.calls.find((c) => c.command === 'task_followup_queue'),
  );
  assert.equal(continued.runId, 'sample');
  assert.equal(continued.prompt, 'Also support Escape to close search.');
  assert.equal(continued.interrupt, false);
  const queuedCalls = await page.evaluate(() =>
    window.taskFixture.calls.filter((c) => c.command === 'task_followup_queue'),
  );
  assert.equal(queuedCalls[0].id, queuedCalls[1].id, 'A retry must reuse its message identifier');
  assert.equal(await page.getByRole('button', { name: 'Stop & send', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Cancel follow-up', exact: true }).click();
  await page.getByRole('list', { name: 'Queued follow-ups' }).waitFor({ state: 'hidden' });
  await reply.fill('Stop and correct the selected behavior now.');
  await page.getByRole('button', { name: 'Stop & send', exact: true }).click();
  await page.waitForFunction(() =>
    window.taskFixture.calls.some((c) => c.command === 'task_followup_queue' && c.interrupt),
  );
  assert.equal(await reply.inputValue(), '');
  await page.getByRole('button', { name: 'Cancel follow-up', exact: true }).click();

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
        await tabs.getByRole('tab', { name: 'Result', exact: true }).click();
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
    window.taskFixture.scenario('review', { result: 'Keyboard search is ready.' }),
  );
  for (const width of [1920, 1280, 960, 680]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const appearance of ['light', 'dark']) {
      await page.evaluate((value) => window.taskFixture.theme(value), appearance);
      const originalBounds = await tabs.boundingBox();
      for (const name of ['Result', 'Review', 'Preview', 'Activity']) {
        await tabs.getByRole('tab', { name, exact: true }).click();
        const bounds = await tabs.boundingBox();
        assert.ok(Math.abs(bounds.x - originalBounds.x) < 1, `${name} keeps the left gutter`);
        assert.ok(
          Math.abs(bounds.width - originalBounds.width) < 1,
          `${name} keeps the page width`,
        );
        const frame = await page.locator('.task-detail').boundingBox();
        assert.ok(frame.width >= width - 18, 'Task details fill the available width');
        if (name === 'Review')
          await page.getByRole('region', { name: 'Code changes', exact: true }).waitFor();
        assert(
          await page.locator('.task-detail').evaluate((el) => el.scrollWidth <= el.clientWidth),
          'Task section overflows',
        );
        assert(
          await page.locator('.result-canvas').evaluate((el) => el.clientHeight >= 160),
          'Result has too little space',
        );
        await page.screenshot({
          path: `${output}/section-${name.toLowerCase()}-${width}-${appearance}.png`,
        });
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 840 });
  await tabs.getByRole('tab', { name: 'Review', exact: true }).click();
  assert.equal(await page.getByRole('tab', { name: 'Review tools', exact: true }).count(), 0);
  const fileMarker = page.getByRole('checkbox', { name: 'Reviewed: src/search.ts', exact: true });
  await fileMarker.focus();
  await page.keyboard.press('Space');
  assert.equal(await fileMarker.isChecked(), true);
  await page.getByText('1 of 1 reviewed', { exact: false }).waitFor();
  await page.reload();
  await page.evaluate(() => window.taskFixture.scenario('review'));
  await tabs.getByRole('tab', { name: 'Review', exact: true }).click();
  assert.equal(await fileMarker.isChecked(), true, 'File tracking survives reopening');
  await page.evaluate(() => {
    window.taskFixture.review = {
      files: ['src/search.ts'],
      diff: 'Changed patch snapshot',
      note: '',
    };
  });
  await page.getByRole('button', { name: 'Refresh changes', exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Reviewed: src/search.ts"]').checked,
  );
  assert.equal(await fileMarker.isChecked(), false, 'Updated changes invalidate old markers');
  await page.evaluate(() =>
    window.taskFixture.scenario('review', {
      contract: {
        requirements: [
          { id: 'keys', title: 'Keyboard navigation works', checkpoint: false, receipt: null },
        ],
        inputs: {},
      },
    }),
  );
  await page.getByRole('button', { name: 'Approve work', exact: true }).click();
  const approval = page.getByRole('dialog', { name: 'Approve work', exact: true });
  const approveButton = approval.getByRole('button', { name: 'Approve work', exact: true });
  assert.equal(await approveButton.isDisabled(), true, 'Outcome approval needs evidence');
  await approval
    .getByRole('textbox', { name: 'What did you verify?', exact: true })
    .fill('Tested keyboard navigation in the preview.');
  await approveButton.click({ trial: true });
  await page.evaluate(() => {
    window.taskFixture.tree = 'new-snapshot';
  });
  await approveButton.click();
  await approval.getByText('Files changed while you were reviewing.', { exact: false }).waitFor();
  assert.equal(
    await page.evaluate(() =>
      window.taskFixture.calls.some((call) => call.command === 'task_mark_reviewed'),
    ),
    false,
  );
  await approval.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Approve work', exact: true }).click();
  await approveButton.click();
  await approval.waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(
      () => window.taskFixture.calls.filter((call) => call.command === 'task_mark_reviewed').length,
    ),
    1,
  );
  assert.equal(
    await page.evaluate(() =>
      window.taskFixture.calls.some((call) => call.command === 'integration_apply'),
    ),
    false,
    'Approval never merges',
  );
  await page.getByRole('tab', { name: 'Changes', exact: true }).click();
  await page.evaluate(async () => {
    const { useExecutionStore } = await import('/src/stores/executionStore.ts');
    useExecutionStore.setState({
      runners: [
        {
          id: 'claude',
          name: 'Claude Code',
          available: true,
          signedIn: true,
          account: 'Fixture',
          detail: 'Browser fixture',
        },
      ],
      discover: async () => {},
    });
  });
  await page.getByRole('button', { name: 'Ask an agent to review', exact: true }).click();
  const capture = page.getByRole('dialog');
  const request = capture.getByRole('textbox', {
    name: 'What do you want to accomplish?',
    exact: true,
  });
  await request.waitFor();
  assert.match(await request.inputValue(), /Source workspace: C:\/Projects\/atlas-task/);
  assert.match(await request.inputValue(), /Do not edit files/);
  assert.equal(
    await page.evaluate(() =>
      window.taskFixture.calls.some(
        (call) => call.command === 'continue' || call.command === 'task_start',
      ),
    ),
    false,
    'Opening a review request does not spend agent tokens',
  );
  await request.fill('My edited peer review request');
  await capture.getByRole('button', { name: 'Close capture', exact: true }).click();
  await page.getByRole('button', { name: 'Ask an agent to review', exact: true }).click();
  assert.equal(await request.inputValue(), 'My edited peer review request');
  await capture.getByRole('button', { name: 'Close capture', exact: true }).click();
  await page.evaluate(() => {
    window.taskFixture.tree = undefined;
    window.taskFixture.review = undefined;
  });
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
  await page.getByText('Waiting for your answer', { exact: true }).waitFor();
  assert.equal(await page.locator('.brand-agent-character').getAttribute('data-state'), 'waiting');
  await page.evaluate(async () => {
    const { useExecutionStore } = await import('/src/stores/executionStore.ts');
    const first = useExecutionStore.getState().runs[0];
    useExecutionStore.setState({
      runs: [
        { ...first, status: 'review', prompts: [] },
        { ...first, id: 'newer', startedAt: '2026-09-11T13:00:00Z' },
      ],
    });
  });
  await page.getByText('You’re viewing an earlier attempt.').waitFor();
  await tabs.getByRole('tab', { name: 'Review', exact: true }).click();
  await page.getByRole('tab', { name: 'Changes', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: 'Approve work', exact: true }).count(),
    0,
    'Earlier attempts cannot be approved from the toolbar',
  );
  await page.waitForTimeout(1200);
  assert.equal(
    await page.evaluate(
      async () =>
        (await import('/src/stores/executionStore.ts')).useExecutionStore.getState().selectedId,
    ),
    'sample',
    'Canceling queued follow-ups must not navigate away from the selected attempt on refresh',
  );
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
  await page.getByRole('tab', { name: 'Checks', exact: false }).click();
  await page.getByRole('heading', { name: 'Requirements · 1', exact: true }).waitFor();
  await page.getByText('Keyboard navigation works', { exact: true }).waitFor();
  const outcomes = page.getByRole('region', {
    name: 'Expected outcomes and evidence',
    exact: true,
  });
  await outcomes.getByRole('button', { name: 'Review evidence', exact: true }).click();
  const evidenceLabel = await outcomes.locator('label[for="evidence-keys"]').boundingBox();
  const evidenceControl = await outcomes
    .getByRole('combobox', { name: 'Evidence', exact: true })
    .boundingBox();
  assert.ok(
    evidenceLabel.y + evidenceLabel.height <= evidenceControl.y + 1,
    'Evidence label sits above its picker',
  );
  await outcomes.screenshot({ path: `${output}/evidence-960-dark.png` });
  await outcomes.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.getByRole('heading', { name: 'Agent evidence', exact: true }).waitFor();
  await page.getByText('Search with arrow keys', { exact: true }).waitFor();
  await page.getByText('Automatic checks could not finish:', { exact: false }).waitFor();
  await page.locator('.task-detail').evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: `${output}/review-tools-960-dark.png` });
  await page.getByRole('button', { name: 'More task actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Task details', exact: true }).click();
  await page.getByText('Example model', { exact: true }).waitFor();
  await page.getByText('Original request', { exact: true }).click();
  await page.getByText('Example model', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/details-960-dark.png` });
  await page.evaluate(() => window.taskFixture.scenario('starting', { workspace: '' }));
  await tabs.getByRole('tab', { name: 'Result', exact: true }).click();
  await page.getByText('Preparing', { exact: true }).waitFor();

  // A long step reports the work it is doing instead of a fixed label.
  await page.evaluate(() =>
    window.taskFixture.scenario('starting', {
      prepareCommand: 'pnpm install --frozen-lockfile',
      progress: {
        step: 'dependencies',
        label: 'Running project setup',
        detail: 'Progress: resolved 337, reused 337, downloaded 0, added 334',
        startedAt: new Date(Date.now() - 134_000).toISOString(),
        attempt: 2,
      },
    }),
  );
  const live = page.getByRole('region', { name: 'Live activity', exact: true });
  await live.getByText('Attempt 2', { exact: true }).waitFor();
  await live.getByText('Progress: resolved 337, reused 337, downloaded 0, added 334').waitFor();
  await live
    .locator('.task-live-elapsed')
    .filter({ hasText: /2m \d+s/ })
    .waitFor();
  await page.getByText('Running project setup', { exact: true }).first().waitFor();
  assert.equal(
    await page.locator('.task-progress-steps').count(),
    0,
    'compact progress keeps the current step above the result',
  );
  await page.screenshot({ path: `${output}/live-progress-1280-dark.png` });

  // A setup failure names the interruption, shows the command's own output, and offers a retry.
  await page.evaluate(() =>
    window.taskFixture.scenario('failed', {
      prepareCommand: 'pnpm install --frozen-lockfile',
      error:
        'The project setup command (pnpm install --frozen-lockfile) produced no output for too long and was stopped after 310s. Tried 2 times.',
      preparation: {
        command: 'pnpm install --frozen-lockfile',
        skipped: false,
        reason: 'produced no output for too long and was stopped after 310s',
        attempts: 2,
        durationMs: 310_000,
        exitCode: null,
        success: false,
        outputTail: 'Progress: resolved 337, reused 337, downloaded 0, added 334',
        finishedAt: new Date().toISOString(),
      },
    }),
  );
  await page.getByText('produced no output for too long', { exact: false }).first().waitFor();
  await page.getByText('Setup output', { exact: false }).click();
  await page.getByText('added 334', { exact: false }).first().waitFor();
  await page.screenshot({ path: `${output}/setup-failure-1280-dark.png` });
  await page.evaluate(() => {
    window.taskFixture.calls.length = 0;
  });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.waitForFunction(() =>
    window.taskFixture.calls.some((call) => call.command === 'task_retry'),
  );
  assert.deepEqual(
    await page.evaluate(() =>
      window.taskFixture.calls
        .filter((call) => call.command !== 'task_followup_snapshot')
        .map((call) => call.command),
    ),
    ['task_retry'],
    'retry dispatches the native retry command rather than starting an unrelated task',
  );
  // The new attempt is opened and reports its own first step.
  await page.getByText('Preparing the workspace', { exact: true }).first().waitFor();
  assert.equal(
    await page.evaluate(
      () => window.taskFixture.calls.findLast((call) => call.command === 'task_retry').id,
    ),
    'sample',
    'the retry names the attempt it replaces',
  );

  // An attempt that already finished offers no retry.
  await page.evaluate(() => window.taskFixture.scenario('review'));
  assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).count(), 0);
  await page.evaluate(() => window.taskFixture.update({ status: 'stopping' }));
  assert(await page.getByRole('button', { name: 'Stop', exact: true }).isDisabled());
  await page.evaluate(() => window.taskFixture.scenario('reviewed'));
  await page.getByText('Ready to merge', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Merge into main' }).click();
  await page.locator('#task-merge').waitFor();
  await page.getByRole('heading', { name: 'Merge into main' }).waitFor();
  await page.getByRole('button', { name: 'Preview merge into main' }).waitFor();
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
    'Task detail browser fixtures passed: states, themes, responsive layouts, reduced motion, keyboard tabs/menu, activity search, live step progress, setup-failure detail, retry dispatch, error disclosure, history, queued follow-ups, failed-save retry and stop-and-send. No native tasks launched.',
  );
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) {
    console.error(await page.locator('body').innerText());
    await page.screenshot({ path: `${output}/failure.png` });
  }
  throw error;
} finally {
  await browser.close();
}
