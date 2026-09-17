import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const origin = process.env.MANAGED_TASK_PREVIEW_URL ?? 'http://127.0.0.1:5403';
const output = 'output/playwright/managed-tasks';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const width of [1920, 1280, 960, 540]) {
    for (const dark of [false, true]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 960 ? 640 : 840 },
        reducedMotion: dark ? 'reduce' : 'no-preference',
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(
        ({ dark }) => {
          const usage = { input: 30, output: 4, reported: true, estimatedCostUsd: 0.001 };
          const request = {
            id: 'parent',
            projectId: 'fixture',
            projectName: 'Fixture project',
            projectPath: 'C:/fixture',
            agent: 'codex',
            model: 'pinned',
            prompt: 'Implement API and UI independently. Preserve saved data.',
            isolated: true,
            autoVerify: true,
            verifyCommand: 'node check.mjs',
            connectionIds: [],
          };
          const assessment = {
            id: 'assessment',
            sourceHead: 'head',
            strategy: 'parallel',
            parallelAvailable: true,
            reason: 'Independent repository areas can be planned together.',
            createdAt: new Date().toISOString(),
            cached: false,
            decision: {
              version: 1,
              kind: 'task_strategy',
              requestedMode: 'jev',
              provider: 'jev',
              policyRevision: 1,
              modelCallAttempted: true,
              usage,
            },
          };
          const task = {
            id: 'parent',
            title: 'Implement API and UI',
            request,
            assessment,
            plannerRunId: 'planner',
            runIds: ['planner'],
            createdAt: new Date().toISOString(),
            started: false,
            error: null,
            delivery: {
              finalItem: 'combined-review',
              integrationItems: ['combined-review'],
              checkedItems: [],
              repairs: [],
              repairLimit: 2,
              workersFinishedAt: null,
              readyAt: null,
              appliedAt: null,
              reviewSeconds: null,
              interventions: 0,
            },
          };
          const runs = [
            {
              id: 'planner',
              taskId: 'planner',
              projectId: 'fixture',
              projectName: 'Fixture project',
              projectPath: 'C:/fixture',
              agent: 'codex',
              status: 'running',
              prompt: 'Plan task',
              result: 'Proposed work is ready.',
              activity: ['Using Grep', 'Using Read'],
              progress: { label: 'Checking repository boundaries', completed: 0, total: 1 },
              usage,
              startedAt: new Date().toISOString(),
              contextReceipt: {},
              prompts: [],
            },
          ];
          const steps = [
            {
              key: 'api',
              title: 'Implement API',
              prompt: 'Implement the API and tests.',
              scopes: ['api'],
              dependsOn: [],
              agent: 'codex',
            },
            {
              key: 'ui',
              title: 'Implement UI',
              prompt: 'Implement the view and tests.',
              scopes: ['ui'],
              dependsOn: [],
              agent: 'codex',
            },
            {
              key: 'combined-review',
              title: 'Review and verify the combined result',
              prompt: 'Review the complete result.',
              scopes: ['.'],
              dependsOn: ['api', 'ui'],
              agent: 'codex',
            },
          ];
          const queue = {
            managedTasks: [task],
            items: [],
            messages: [],
            enabledProjects: [],
            concurrency: 3,
            bridgeUrl: 'fixture',
            bridgeError: null,
            mergedRunIds: [],
          };
          window.fixture = {
            dark,
            request,
            assessment,
            task,
            runs,
            steps,
            queue,
            calls: [],
            pending: null,
          };
          window.__TAURI_INTERNALS__ = {
            invoke: async (command, args) => {
              const f = window.fixture;
              f.calls.push({ command, args });
              if (command === 'task_strategy_assess')
                return new Promise((resolve) => {
                  f.pending = resolve;
                });
              if (command === 'task_strategy_cancel') {
                f.pending?.(f.assessment);
                f.pending = null;
                return;
              }
              if (command === 'task_plan_create') return f.task.id;
              if (command === 'queue_snapshot') return f.queue;
              if (command === 'task_plan_preview') {
                if (f.previewError) throw Error('The saved plan could not be loaded.');
                return f.steps;
              }
              if (command === 'task_plan_start') {
                assertFixture(args.plannerRunId === 'planner');
                f.task.started = true;
                f.queue.items = f.steps.map((s, index) => ({
                  id: s.key,
                  featureId: f.task.id,
                  title: s.title,
                  projectId: 'fixture',
                  runId: index === 0 ? 'worker' : null,
                  dependencies: s.dependsOn,
                  agent: s.agent,
                }));
                f.queue.enabledProjects = ['managed:parent'];
                f.task.runIds.push('worker');
                f.runs.push({
                  ...f.runs[0],
                  id: 'worker',
                  taskId: 'worker',
                  status: 'running',
                  progress: { label: 'Implementing API changes', completed: 0, total: 1 },
                  startedAt: new Date().toISOString(),
                });
                f.sync();
                return;
              }
              if (command === 'task_plan_action') {
                if (args.action === 'retry-plan') {
                  f.runs[0].status = 'running';
                  f.runs[0].error = null;
                }
                if (args.action === 'pause') f.queue.enabledProjects = [];
                if (args.action === 'stop') {
                  f.queue.enabledProjects = [];
                  f.runs.forEach((run) => {
                    if (run.status === 'running') run.status = 'stopped';
                  });
                }
                f.sync();
                return;
              }
              if (command === 'task_strategy_history')
                return [
                  {
                    id: 'assessment',
                    projectId: 'fixture',
                    createdAt: f.assessment.createdAt,
                    decision: f.assessment.decision,
                  },
                ];
              if (command === 'task_list') return f.runs;
              if (command === 'integration_prepare') {
                f.integration = {
                  id: 'combined-plan',
                  runIds: args.runIds,
                  projectPath: 'C:/fixture',
                  targetBranch: 'main',
                  masterHead: '12345678',
                  status: 'ready',
                  sources: [],
                  files: f.reviewFiles ?? ['feature.txt'],
                  patch: (f.reviewFiles ?? ['feature.txt'])
                    .map(
                      (file) =>
                        `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1 @@\n+Combined feature\n`,
                    )
                    .join(''),
                  conflicts: [],
                  commitMessage: args.commitMessage,
                  commitPolicy: {
                    attribution: 'user',
                    name: 'Fixture',
                    email: 'fixture@example.invalid',
                    cleanupAfterMerge: true,
                  },
                  cleanupResults: [],
                };
                return f.integration;
              }
              if (command === 'integration_apply') {
                f.integration.status = 'applied';
                f.integration.cleanupResults = [
                  { runId: 'combined', removed: args.cleanup, error: null },
                ];
                f.queue.mergedRunIds = [...f.integration.runIds];
                f.task.delivery.appliedAt = new Date().toISOString();
                f.sync();
                return f.integration;
              }
              if (command === 'task_review')
                return {
                  files: f.reviewFiles ?? ['feature.txt'],
                  diff: (f.reviewFiles ?? ['feature.txt'])
                    .map(
                      (file) =>
                        `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1 @@\n+Combined feature\n`,
                    )
                    .join(''),
                  note: '',
                };
              if (command === 'task_plan_review_time') return;
              if (command === 'integration_plans')
                return f.integration
                  ? [
                      f.integration,
                      { ...f.integration, id: 'other-task-plan', runIds: ['other-task'] },
                    ]
                  : [];
              if (command === 'knowledge_list') return [];
              return null;
            },
          };
          function assertFixture(ok) {
            if (!ok) throw Error('Wrong reviewed planner receipt');
          }
        },
        { dark },
      );
      await page.route(`${origin}/managed-fixture.html`, (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Managed task browser fixture</title></head><body><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
      const source=await fetch('/src/components/tasks/ManagedTaskView.tsx').then(r=>r.text());const reactUrl=source.split('"').find(url=>url.includes('/react.js?'));const {default:React}=await import(reactUrl);const mainSource=await fetch('/src/main.tsx').then(r=>r.text());const domUrl=mainSource.split('"').find(url=>url.includes('/react-dom_client.js?'));const {default:ReactDOM}=await import(domUrl);
      await import('/src/index.css');await import('/src/components/ui/experience.css');await import('/src/components/tasks/task-workspace.css');await import('/src/components/sessions/live-session.css');
      const {useThemeStore}=await import('/src/stores/themeStore.ts');const theme=useThemeStore.getState();theme.setAppTheme({...theme.appTheme,appearance:'manual',isDark:window.fixture.dark});
      const {useProjectStore}=await import('/src/stores/projectStore.ts');const {useExecutionStore}=await import('/src/stores/executionStore.ts');const {useManagedTaskStore}=await import('/src/stores/managedTaskStore.ts');
      const f=window.fixture;const project={id:'fixture',name:'Fixture project',path:'C:/fixture',gitBranch:'main',worktrees:[],preferences:{verifyCommand:'node check.mjs',autoVerify:true}};useProjectStore.setState({projects:[project],activeProjectId:'fixture'});
      f.sync=()=>{useExecutionStore.setState({runs:structuredClone(f.runs),refresh:async()=>{},select:()=>{}});useManagedTaskStore.setState({queue:structuredClone(f.queue),refresh:async()=>f.sync()});};f.sync();
      const {ManagedTaskView}=await import('/src/components/tasks/ManagedTaskView.tsx');const {useTaskAssessment,TaskAssessmentNotice}=await import('/src/components/tasks/useTaskAssessment.tsx');const {DecisionUsage,useTaskDecisionUsage}=await import('/src/components/tasks/DecisionUsage.tsx');
      function App(){const assessment=useTaskAssessment();const decisionUsage=useTaskDecisionUsage();const selected=useManagedTaskStore(s=>s.selectedId);const task=useManagedTaskStore(s=>s.queue.managedTasks[0]);const [error,setError]=React.useState('');const act=fn=>fn().catch(e=>setError(String(e)));return React.createElement('main',{className:'live-hub',style:{height:'100dvh',width:'100%'}},selected?React.createElement('div',{className:'live-hub-body'},React.createElement('div',{className:'live-hub-canvas'},React.createElement(ManagedTaskView,{task,onBack:()=>useManagedTaskStore.getState().select(null)}))):React.createElement(React.Fragment,null,React.createElement('h1',null,'Start a task'),React.createElement('button',{onClick:()=>act(()=>assessment.assess(f.request,f.request.prompt))},'Assess fixture'),React.createElement(TaskAssessmentNotice,{assessment:assessment.assessment,busy:assessment.busy,onCancel:()=>act(assessment.cancel),onSingle:()=>{},onPlan:()=>act(()=>assessment.create(f.request,f.request.prompt))}),React.createElement('p',{role:'status'},error)),!selected&&React.createElement(DecisionUsage,{...decisionUsage,projectId:'fixture'}));}
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
      </script></body></html>`,
        }),
      );
      await page.goto(`${origin}/managed-fixture.html`);
      await page.getByRole('button', { name: 'Assess fixture' }).click();
      await page.getByRole('button', { name: 'Cancel assessment' }).click();
      await page.getByRole('button', { name: 'Assess fixture' }).click();
      await page.waitForFunction(() => !!window.fixture.pending);
      await page.evaluate(() => window.fixture.pending(window.fixture.assessment));
      await page.getByRole('button', { name: 'Create a plan', exact: true }).click();
      const overview = page.getByRole('tab', { name: 'Overview', exact: true });
      const activity = page.getByRole('tab', { name: 'Activity', exact: true });
      const details = page.getByText('Task details', { exact: true });
      await page.getByRole('heading', { name: 'Planning your task' }).waitFor();
      const planningCharacter = page.locator('.managed-planning-status .brand-agent-character');
      assert.equal(await planningCharacter.getAttribute('data-state'), 'working');
      if (dark)
        assert.equal(
          await planningCharacter.evaluate((el) => getComputedStyle(el).animationName),
          'none',
        );
      if (width === 1280 && !dark) {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(
          await planningCharacter.evaluate((el) => getComputedStyle(el).animationName),
          'none',
        );
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.evaluate(() => {
          Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
          window.dispatchEvent(new Event('blur'));
        });
        await page.waitForFunction(
          () =>
            !document
              .querySelector('.managed-planning-status .managed-agent')
              .hasAttribute('data-animated'),
        );
        await page.evaluate(() => {
          delete document.hasFocus;
          window.dispatchEvent(new Event('focus'));
        });
        await page.waitForFunction(() =>
          document
            .querySelector('.managed-planning-status .managed-agent')
            .hasAttribute('data-animated'),
        );
      }
      assert.equal(await page.getByText('No result yet.', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('heading', { name: 'Usage', exact: true }).count(), 0);
      assert.equal(
        await page.locator('.managed-task').evaluate((el) => getComputedStyle(el).overflowY),
        'visible',
      );
      assert.equal(
        await page.locator('.live-hub-canvas').evaluate((el) => getComputedStyle(el).overflowY),
        'auto',
      );
      await page.screenshot({
        path: `${output}/${width}-${dark ? 'dark' : 'light'}-planning.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: 'View activity', exact: true }).click();
      await page.getByRole('searchbox', { name: 'Search activity' }).waitFor();
      assert.equal(await activity.evaluate((el) => el === document.activeElement), true);
      await page.locator('summary').filter({ hasText: 'Using Read' }).waitFor();
      await details.focus();
      await details.press('Enter');
      await page.getByRole('heading', { name: 'Your request', exact: true }).waitFor();
      await page.getByRole('heading', { name: 'Usage', exact: true }).waitFor();
      await page.screenshot({
        path: `${output}/${width}-${dark ? 'dark' : 'light'}-details.png`,
        fullPage: true,
      });
      await details.press('Enter');
      await activity.focus();
      await activity.press('Home');
      await page.getByRole('heading', { name: 'Planning your task' }).waitFor();
      assert.equal(await page.locator('#managed-attempt-result').count(), 0);
      await page.evaluate(() => {
        const f = window.fixture;
        f.runs[0].prompts = [
          {
            id: 'question',
            status: 'pending',
            question: 'Which API version should I use?',
            inputType: 'text',
            options: [],
            createdAt: new Date().toISOString(),
          },
        ];
        f.sync();
      });
      await page.getByText('Waiting for your answer', { exact: true }).waitFor();
      assert.equal(await planningCharacter.getAttribute('data-state'), 'waiting');
      await page.evaluate(() => {
        const f = window.fixture;
        f.runs[0].prompts = [];
        f.runs[0].status = 'failed';
        f.runs[0].error = 'The provider disconnected.';
        f.sync();
      });
      await page.getByRole('button', { name: 'Retry planning', exact: true }).click();
      await page.getByRole('heading', { name: 'Planning your task' }).waitFor();
      await page.evaluate(() => {
        window.fixture.previewError = true;
        window.fixture.runs[0].status = 'review';
        window.fixture.runs[0].progress = null;
        window.fixture.sync();
      });
      await page.getByRole('button', { name: 'Reload plan', exact: true }).waitFor();
      await page.evaluate(() => {
        window.fixture.previewError = false;
      });
      await page.getByRole('button', { name: 'Reload plan', exact: true }).click();
      const start = page.getByRole('button', { name: 'Start reviewed plan' });
      await start.waitFor().catch(async (error) => {
        console.error(
          await page.locator('body').innerText(),
          errors,
          await page.evaluate(() => window.fixture.calls),
        );
        throw error;
      });
      assert.equal(
        await page.evaluate(
          () => window.fixture.calls.filter((c) => c.command === 'task_plan_start').length,
        ),
        0,
      );
      await start.focus();
      assert.equal(await start.evaluate((el) => el === document.activeElement), true);
      await page.screenshot({
        path: `${output}/${width}-${dark ? 'dark' : 'light'}-plan.png`,
        fullPage: true,
      });
      await start.press('Enter');
      await page.getByRole('button', { name: 'Pause dispatch' }).waitFor();
      const taskHeading = page.getByRole('heading', { name: 'Implement API and UI', exact: true });
      assert.equal(await taskHeading.evaluate((el) => el === document.activeElement), true);
      assert.ok(
        (await taskHeading.boundingBox()).y >= 0,
        'Starting work keeps the task title in view',
      );
      await page.screenshot({
        path: `${output}/${width}-${dark ? 'dark' : 'light'}-working.png`,
        fullPage: true,
      });
      const live = page
        .locator('.managed-assignment')
        .filter({ has: page.getByRole('region', { name: 'Live activity' }) })
        .first();
      await page.evaluate(() => {
        const worker = window.fixture.runs.find((run) => run.id === 'worker');
        worker.activity = ['Reading src/task.ts', 'Searching the project', 'Editing src/task.ts'];
        worker.progress = null;
        window.fixture.sync();
      });
      await live.getByText('Editing src/task.ts', { exact: true }).waitFor();
      assert.equal(await live.locator('.task-live-recent li').count(), 2);
      await page.evaluate(() => {
        const worker = window.fixture.runs.find((run) => run.id === 'worker');
        worker.progress = {
          step: 'verification',
          label: 'Running project checks',
          detail: 'Compiling task_runtime v1.0.0',
          startedAt: new Date().toISOString(),
          attempt: 1,
        };
        window.fixture.sync();
      });
      await live.getByText('Compiling task_runtime v1.0.0', { exact: true }).waitFor();
      assert.equal(await taskHeading.evaluate((el) => el === document.activeElement), true);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({
        path: `${output}/${width}-${dark ? 'dark' : 'light'}-live-checks.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Stop task' }).click();
      await page.getByRole('button', { name: 'Retry assignment' }).waitFor();
      await page.screenshot({
        path: `${output}/${width}-${dark ? 'dark' : 'light'}-stopped.png`,
        fullPage: true,
      });
      assert.equal(
        await page
          .locator('.managed-assignment .brand-agent-character[data-state="working"]')
          .count(),
        0,
      );
      await activity.click();
      await page.getByRole('combobox', { name: 'Choose attempt' }).click();
      await page.getByRole('option', { name: /^Planning/ }).click();
      await page.getByRole('button', { name: 'View result', exact: true }).click();
      await page.getByRole('heading', { name: 'Planning result', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Close details', exact: true }).click();
      assert.equal(await overview.evaluate((el) => el === document.activeElement), true);
      await page.evaluate(() => {
        const f = window.fixture;
        f.queue.items.forEach((item, index) => {
          const id = index === 0 ? 'worker' : index === 1 ? 'ui-worker' : 'combined';
          item.runId = id;
          const run = {
            ...f.runs[0],
            id,
            taskId: id,
            status: 'review',
            workspace: `C:/fixture/${id}`,
            branch: id,
            targetBranch: 'main',
            result:
              'The API and UI now work together. The complete flow and project checks passed.',
            verifyCommand: 'node check.mjs',
            endedAt: new Date().toISOString(),
            verification: {
              command: 'node check.mjs',
              checkedAt: new Date().toISOString(),
              tree: id,
              result: {
                success: true,
                durationMs: 2000,
                stdout: 'Checks passed',
                stderr: '',
                exitCode: 0,
              },
            },
          };
          const old = f.runs.findIndex((entry) => entry.id === id);
          if (old >= 0) f.runs[old] = run;
          else f.runs.push(run);
          if (!f.task.runIds.includes(id)) f.task.runIds.push(id);
        });
        f.task.delivery.workersFinishedAt = new Date(Date.now() - 120000).toISOString();
        f.task.delivery.readyAt = new Date().toISOString();
        f.sync();
      });
      const review = page.getByRole('button', { name: 'Review changes', exact: true });
      await review.waitFor();
      assert.equal(await page.getByRole('navigation', { name: 'Task result' }).count(), 1);
      await page.getByText('The API and UI now work together.', { exact: false }).waitFor();
      await activity.click();
      await details.focus();
      await details.press('Enter');
      await page.getByRole('heading', { name: 'Your request', exact: true }).waitFor();
      await details.press('Enter');
      await overview.click();
      await review.focus();
      await page.screenshot({
        path: `${output}/${width}-${dark ? 'dark' : 'light'}-result.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      await page.getByRole('region', { name: 'Try result', exact: true }).waitFor();
      await review.focus();
      await review.press('Enter');
      assert.equal(await review.count(), 0);
      assert.equal(
        await page
          .getByRole('button', { name: 'Review', exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      const apply = page.getByRole('button', { name: 'Apply changes to main', exact: true });
      await apply.waitFor();
      await page.getByText('Combined feature', { exact: false }).first().waitFor();
      assert.equal(await page.getByRole('navigation', { name: 'Changed files' }).count(), 1);
      assert.equal(
        await page.getByText('Previous integration reviews', { exact: true }).count(),
        0,
      );
      const diffTop = (await page.locator('.task-review .changed-files').boundingBox()).y;
      assert.ok(
        diffTop < (width === 960 ? 640 : 840),
        'The diff should begin in the first viewport',
      );
      assert.equal(
        await page.evaluate(
          () => window.fixture.calls.filter((call) => call.command === 'integration_apply').length,
        ),
        0,
      );
      assert.equal(await page.getByText('Select all ready tasks', { exact: true }).count(), 0);
      await page.screenshot({
        path: `${output}/${width}-${dark ? 'dark' : 'light'}-review.png`,
        fullPage: true,
      });
      const commitDetails = page.getByText('Commit details', { exact: true });
      await commitDetails.click();
      const commitMessage = page.getByRole('textbox', { name: 'Commit message', exact: true });
      await commitMessage.fill('Complete API and UI');
      assert.equal(await apply.count(), 0, 'An edited commit requires a fresh review');
      assert.equal(
        await commitMessage.isVisible(),
        true,
        'Editing must retain the field and focus',
      );
      await page.getByText('Combined feature', { exact: false }).first().waitFor();
      await page.getByRole('button', { name: 'Refresh merge', exact: true }).click();
      await apply.waitFor();
      assert.equal(
        await page.evaluate(() => window.fixture.integration.commitMessage),
        'Complete API and UI',
      );
      await commitDetails.click();
      await apply.focus();
      if ((width === 1280 && !dark) || (width === 540 && dark)) {
        await page.evaluate(() => {
          window.fixture.reviewFiles = [
            'feature.txt',
            'src/components/settings/AccountPreferences.tsx',
            'src/server/feature-handler.ts',
          ];
        });
        await page.getByRole('button', { name: 'Refresh changes', exact: true }).click();
        const files = page.getByRole('navigation', { name: 'Changed files' });
        const selectedFile = files.getByRole('button', {
          name: 'src/components/settings/AccountPreferences.tsx',
          exact: true,
        });
        await selectedFile.click();
        assert.equal(await selectedFile.getAttribute('aria-pressed'), 'true');
        await page.screenshot({
          path: `${output}/${width}-${dark ? 'dark' : 'light'}-files.png`,
          fullPage: true,
        });
        await apply.focus();
      }
      await apply.press('Enter');
      await page.getByText('Integrated into main', { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(
          () => window.fixture.calls.filter((call) => call.command === 'integration_apply').length,
        ),
        1,
      );
      assert.equal(await page.evaluate(() => window.fixture.integration.runIds.length), 3);
      assert.equal(
        await page.locator('body').evaluate((el) => el.scrollWidth > window.innerWidth),
        false,
      );
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`Managed task flow passed: ${width}px ${dark ? 'dark' : 'light'}`);
    }
  }
} finally {
  await browser.close();
}
