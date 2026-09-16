import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const origin = process.env.DECISION_USAGE_PREVIEW_URL ?? 'http://127.0.0.1:5198';
const output = 'output/playwright/decision-usage';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const width of [1280, 960]) {
    for (const dark of [false, true]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 1280 ? 840 : 640 },
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(
        ({ dark }) => {
          const usage = {
            input: 100,
            output: 2,
            cacheRead: 0,
            cacheWrite: 0,
            reported: true,
            estimatedCostUsd: 0.0000042,
          };
          const record = {
            id: 'assessment-one',
            projectId: 'alpha',
            createdAt: new Date().toISOString(),
            decision: {
              version: 1,
              kind: 'task_strategy',
              requestedMode: 'jev',
              provider: 'agent',
              policyRevision: 1,
              modelCallAttempted: true,
              usage,
              attempts: [
                { provider: 'jev', usage },
                { provider: 'agent', usage },
              ],
            },
          };
          window.fixture = { dark, download: null };
          URL.createObjectURL = (blob) => {
            window.fixture.download = blob;
            return 'blob:fixture';
          };
          URL.revokeObjectURL = () => {};
          HTMLAnchorElement.prototype.click = () => {};
          window.__TAURI_INTERNALS__ = {
            invoke: async (command) => {
              if (command === 'task_strategy_history')
                return [
                  record,
                  record,
                  {
                    ...record,
                    id: 'assessment-two',
                    projectId: 'beta',
                    decision: {
                      ...record.decision,
                      provider: 'local_rules',
                      attempts: [],
                      usage: { ...usage, reported: false, estimatedCostUsd: null },
                    },
                  },
                  {
                    ...record,
                    id: 'local',
                    decision: { ...record.decision, modelCallAttempted: false },
                  },
                ];
              if (command === 'routing_connection_usage')
                return { calls: 0, unreportedCalls: 0, usage };
              throw Error(`Unexpected fixture command: ${command}`);
            },
          };
        },
        { dark },
      );
      await page.route(`${origin}/decision-usage-fixture.html`, (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html><head><meta charset="utf-8"><title>Decision usage fixture</title></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
const source=await fetch('/src/components/tasks/UsageDashboard.tsx').then(r=>r.text());const reactUrl=source.split('"').find(url=>url.includes('/react.js?'));const {default:React}=await import(reactUrl);const mainSource=await fetch('/src/main.tsx').then(r=>r.text());const domUrl=mainSource.split('"').find(url=>url.includes('/react-dom_client.js?'));const {default:ReactDOM}=await import(domUrl);
await import('/src/index.css');await import('/src/components/ui/experience.css');await import('/src/components/tasks/task-workspace.css');
const {useThemeStore}=await import('/src/stores/themeStore.ts');const theme=useThemeStore.getState();theme.setAppTheme({...theme.appTheme,appearance:'manual',isDark:window.fixture.dark});
const {useProjectStore}=await import('/src/stores/projectStore.ts');useProjectStore.setState({projects:[{id:'alpha',name:'Alpha',path:'C:/fixture/alpha'},{id:'beta',name:'Beta',path:'C:/fixture/beta'}]});
const {useExecutionStore}=await import('/src/stores/executionStore.ts');useExecutionStore.setState({runs:[],loading:false,error:null,historyError:null,refresh:async()=>{}});
const {useHelperStore}=await import('/src/stores/helperStore.ts');useHelperStore.setState({refresh:async()=>{},syncError:null});
const {useCapacityStore}=await import('/src/stores/capacityStore.ts');useCapacityStore.setState({records:[],loading:false,error:null,fetch:async()=>{}});
const {UsageDashboard}=await import('/src/components/tasks/UsageDashboard.tsx');ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(UsageDashboard,{onTask:()=>{}}));
</script></body></html>`,
        }),
      );
      await page.goto(`${origin}/decision-usage-fixture.html`);
      const assessments = page.getByRole('region', { name: 'Task assessment usage' });
      await assessments.getByText(/2 assessments/).waitFor();
      assert.match(await assessments.innerText(), /3 model calls/);
      assert.match(await assessments.innerText(), /1 usage reports unavailable/);
      const exportButton = page.getByRole('button', { name: 'Export', exact: true });
      assert.equal(await exportButton.isEnabled(), true, await page.locator('body').innerText());
      await exportButton.click();
      let exported = await page.evaluate(async () =>
        JSON.parse(await window.fixture.download.text()),
      );
      assert.equal(exported.schema, 5);
      assert.equal(exported.attempts.length, 0);
      assert.deepEqual(
        exported.taskAssessments.assessments.map((entry) => entry.id),
        ['assessment-one', 'assessment-two'],
      );
      await page.getByRole('combobox', { name: 'Project', exact: true }).click();
      await page.getByRole('option', { name: 'Alpha', exact: true }).click();
      await assessments.getByText(/1 assessment ·/).waitFor();
      await exportButton.click();
      exported = await page.evaluate(async () => JSON.parse(await window.fixture.download.text()));
      assert.equal(exported.filters.project, 'alpha');
      assert.equal(exported.taskAssessments.assessments.length, 1);
      assert.equal(
        exported.taskAssessments.assessments[0].decision.usage.estimatedCostUsd,
        0.0000042,
      );
      await assessments.getByText('Assessment details', { exact: true }).click();
      await assessments.getByRole('cell', { name: 'Agent (fallback)', exact: true }).waitFor();
      assert.equal(exported.taskAssessments.assessments[0].decision.attempts.length, 2);
      await page.screenshot({
        path: `${output}/${width}-${dark ? 'dark' : 'light'}.png`,
        fullPage: true,
      });
      assert.equal(
        await page.locator('body').evaluate((el) => el.scrollWidth > window.innerWidth),
        false,
      );
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`Decision usage and export passed: ${width}px ${dark ? 'dark' : 'light'}`);
    }
  }
} finally {
  await browser.close();
}
