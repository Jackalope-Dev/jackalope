import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const origin = process.env.ORCHESTRATION_PREVIEW_URL ?? 'http://127.0.0.1:5391';
const output = 'output/playwright/orchestration';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const width of [1280, 960])
    for (const dark of [false, true]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 960 ? 640 : 840 },
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => {
        errors.push(error.message);
        console.error(error.message);
      });
      await page.addInitScript(
        ({ dark }) => {
          window.fixture = {
            dark,
            imports: [],
            goal: 'Build the fixture feature\nPreserve all saved data.\nNever publish changes.',
          };
          Object.defineProperty(navigator, 'clipboard', {
            value: {
              writeText: async (value) => {
                window.fixture.copied = value;
              },
            },
          });
          window.__TAURI_INTERNALS__ = {
            invoke: async (command, args) => {
              if (command === 'queue_import') window.fixture.imports.push(args.request);
              if (command === 'knowledge_list') return [];
              return null;
            },
          };
          localStorage.setItem(
            'jackalope-feature-plan:fixture:multi',
            JSON.stringify({
              featureId: 'ce39bebe-d9b3-4af8-acf5-bb8847bf8e1e',
              goal: window.fixture.goal,
              agent: 'auto',
              steps: [
                {
                  key: 'logic',
                  title: 'Implement logic',
                  prompt: 'Implement logic in its owned file.',
                  agent: 'auto',
                  scopes: ['logic.mjs'],
                  dependsOn: [],
                },
                {
                  key: 'view',
                  title: 'Implement view',
                  prompt: 'Implement the independent view.',
                  agent: 'auto',
                  scopes: ['view.mjs'],
                  dependsOn: [],
                },
              ],
            }),
          );
        },
        { dark },
      );
      await page.route(`${origin}/orchestration-fixture.html`, (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html><head><meta charset="utf-8"><title>Orchestration browser fixture</title></head><body><p>Browser state only; no native tasks launched.</p><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
      const source=await fetch('/src/components/tasks/FeaturePlanner.tsx').then(r=>r.text()); const reactUrl=source.split('"').find(url=>url.includes('/react.js?')); const {default:React}=await import(reactUrl); const {default:ReactDOM}=await import(reactUrl.replace('react.js','react-dom_client.js'));
      await import('/src/index.css'); await import('/src/components/ui/experience.css'); await import('/src/components/tasks/task-workspace.css');
      const {useThemeStore}=await import('/src/stores/themeStore.ts'); const theme=useThemeStore.getState(); theme.setAppTheme({...theme.appTheme,appearance:'manual',isDark:window.fixture.dark});
      const {useProjectStore}=await import('/src/stores/projectStore.ts'); const {useExecutionStore}=await import('/src/stores/executionStore.ts');
      const project={id:'fixture',name:'Fixture project',path:'C:/fixture',gitBranch:'main',worktrees:[],agentProvider:'codex',preferences:{verifyCommand:'node check.mjs',autoVerify:true}};
      useProjectStore.setState({projects:[project],activeProjectId:'fixture'}); useExecutionStore.setState({runs:[],runners:[{id:'codex',name:'Codex',available:true,signedIn:true}],submitting:false});
      const {FeaturePlanner}=await import('/src/components/tasks/FeaturePlanner.tsx');
      const {AgentMetricsDashboard}=await import('/src/components/tasks/AgentMetricsDashboard.tsx');
      const runs=[{id:'one',taskId:'one',projectId:'fixture',projectPath:'C:/fixture',projectName:'Fixture project',prompt:'Private prompt',agent:'codex',status:'review',startedAt:'2026-09-09T12:00:00Z',endedAt:'2026-09-09T12:01:00Z',usage:{input:0,output:0,reported:false},stages:[{stage:'execution',startedAt:'2026-09-09T12:00:00Z',endedAt:'2026-09-09T12:01:00Z',durationMs:60000}]}];
      function App(){const [open,setOpen]=React.useState(false);return React.createElement(React.Fragment,null,React.createElement('button',{onClick:()=>setOpen(true)},'Plan fixture'),React.createElement(AgentMetricsDashboard,{runs}),open&&React.createElement(FeaturePlanner,{project,multiAgent:true,initialGoal:window.fixture.goal,onClose:()=>setOpen(false),onAdded:async()=>{}}));}
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
    </script></body></html>`,
        }),
      );
      await page.goto(`${origin}/orchestration-fixture.html`);
      await page.getByRole('button', { name: 'Plan fixture', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      await page.getByRole('button', { name: 'Add independent review', exact: true }).click();
      await page
        .getByRole('checkbox', { name: /Continue dependencies from verified snapshots/ })
        .check();
      assert.equal(
        await page.getByRole('textbox', { name: 'Task 3', exact: true }).inputValue(),
        'Review and verify the combined feature',
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.screenshot({
        path: `${output}/${width}-${dark ? 'dark' : 'light'}.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Add reviewed plan, paused', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      const saved = await page.evaluate(() => window.fixture.imports[0]);
      assert.equal(saved.stagedDependencies, true);
      assert.equal(saved.items.length, 3);
      assert.ok(saved.items.every((item) => item.prompt.includes('Never publish changes.')));
      assert.deepEqual(saved.items[2].dependsOn, ['logic', 'view']);
      await page.getByRole('button', { name: 'Plan fixture', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.textContent === 'Plan fixture');
      await page.getByRole('heading', { name: 'Execution time', exact: true }).waitFor();
      await page.getByText('execution: 60.0s', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Copy evaluation data', exact: true }).click();
      await page.getByRole('button', { name: 'Copied evaluation data', exact: true }).waitFor();
      const copied = await page.evaluate(() => window.fixture.copied);
      assert.equal(JSON.parse(copied).stageTotalsMs.execution, 60000);
      assert.equal(JSON.parse(copied).episodes[0].outcome, null);
      assert.ok(!copied.includes('Private prompt') && !copied.includes('C:/fixture'));
      await page.screenshot({
        path: `${output}/metrics-${width}-${dark ? 'dark' : 'light'}.png`,
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      await context.close();
    }
  console.log(
    'Planner browser fixtures passed at both sizes and themes with reduced motion, full request retention, staged import and independent review. No native tasks launched.',
  );
} finally {
  await browser.close();
}
