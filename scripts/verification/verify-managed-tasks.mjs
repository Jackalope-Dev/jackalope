import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const origin = process.env.MANAGED_TASK_PREVIEW_URL ?? 'http://127.0.0.1:5403';
const output = 'output/playwright/managed-tasks';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const width of [1280, 960, 540]) {
    for (const dark of [false, true]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
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
          };
          const runs = [
            {
              id: 'planner',
              taskId: 'planner',
              projectId: 'fixture',
              projectName: 'Fixture project',
              projectPath: 'C:/fixture',
              agent: 'codex',
              status: 'review',
              prompt: 'Plan task',
              result: 'Proposed work is ready.',
              activity: [],
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
              if (command === 'task_plan_preview') return f.steps;
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
                }));
                f.queue.enabledProjects = ['managed:parent'];
                f.task.runIds.push('worker');
                f.runs.push({
                  ...f.runs[0],
                  id: 'worker',
                  taskId: 'worker',
                  status: 'running',
                  startedAt: new Date().toISOString(),
                });
                f.sync();
                return;
              }
              if (command === 'task_plan_action') {
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
              if (command === 'knowledge_list' || command === 'integration_list') return [];
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
          body: `<!doctype html><html><head><meta charset="utf-8"><title>Managed task browser fixture</title></head><body><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
      const source=await fetch('/src/components/tasks/ManagedTaskView.tsx').then(r=>r.text());const reactUrl=source.split('"').find(url=>url.includes('/react.js?'));const {default:React}=await import(reactUrl);const mainSource=await fetch('/src/main.tsx').then(r=>r.text());const domUrl=mainSource.split('"').find(url=>url.includes('/react-dom_client.js?'));const {default:ReactDOM}=await import(domUrl);
      await import('/src/index.css');await import('/src/components/ui/experience.css');await import('/src/components/tasks/task-workspace.css');
      const {useThemeStore}=await import('/src/stores/themeStore.ts');const theme=useThemeStore.getState();theme.setAppTheme({...theme.appTheme,appearance:'manual',isDark:window.fixture.dark});
      const {useProjectStore}=await import('/src/stores/projectStore.ts');const {useExecutionStore}=await import('/src/stores/executionStore.ts');const {useManagedTaskStore}=await import('/src/stores/managedTaskStore.ts');
      const f=window.fixture;const project={id:'fixture',name:'Fixture project',path:'C:/fixture',gitBranch:'main',worktrees:[],preferences:{verifyCommand:'node check.mjs',autoVerify:true}};useProjectStore.setState({projects:[project],activeProjectId:'fixture'});
      f.sync=()=>{useExecutionStore.setState({runs:structuredClone(f.runs),refresh:async()=>{},select:()=>{}});useManagedTaskStore.setState({queue:structuredClone(f.queue),refresh:async()=>f.sync()});};f.sync();
      const {ManagedTaskView}=await import('/src/components/tasks/ManagedTaskView.tsx');const {useTaskAssessment,TaskAssessmentNotice}=await import('/src/components/tasks/useTaskAssessment.tsx');const {DecisionUsage,useTaskDecisionUsage}=await import('/src/components/tasks/DecisionUsage.tsx');
      function App(){const assessment=useTaskAssessment();const decisionUsage=useTaskDecisionUsage();const selected=useManagedTaskStore(s=>s.selectedId);const task=useManagedTaskStore(s=>s.queue.managedTasks[0]);const [error,setError]=React.useState('');const act=fn=>fn().catch(e=>setError(String(e)));return React.createElement('main',{style:{maxWidth:1100,margin:'auto',padding:24}},selected?React.createElement(ManagedTaskView,{task,onBack:()=>useManagedTaskStore.getState().select(null)}):React.createElement(React.Fragment,null,React.createElement('h1',null,'Start a task'),React.createElement('button',{onClick:()=>act(()=>assessment.assess(f.request,f.request.prompt))},'Assess fixture'),React.createElement(TaskAssessmentNotice,{assessment:assessment.assessment,busy:assessment.busy,onCancel:()=>act(assessment.cancel),onSingle:()=>{},onPlan:()=>act(()=>assessment.create(f.request,f.request.prompt))}),React.createElement('p',{role:'status'},error)),React.createElement(DecisionUsage,{...decisionUsage,projectId:'fixture'}));}
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
      await page.getByRole('button', { name: 'Stop task' }).click();
      await page.getByRole('button', { name: 'Retry assignment' }).waitFor();
      await page.getByText('All attempts (2)', { exact: true }).click();
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
