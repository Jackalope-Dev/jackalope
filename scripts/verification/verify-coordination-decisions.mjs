import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const origin = process.env.COORDINATION_PREVIEW_URL ?? 'http://127.0.0.1:5398';
const output = 'output/playwright/coordination-decisions';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const width of [1280, 960]) {
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
          window.fixture = { dark, calls: [] };
        },
        { dark },
      );
      await page.route(`${origin}/coordination-fixture.html`, (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html><head><meta charset="utf-8"><title>Coordination fixture</title></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
const source=await fetch('/src/main.tsx').then(r=>r.text()); const reactUrl=source.split('"').find(url=>url.includes('/react.js?')); const {default:React}=await import(reactUrl); const {default:ReactDOM}=await import(source.split('"').find(url=>url.includes('/react-dom_client.js?')));
await import('/src/index.css'); await import('/src/components/ui/experience.css'); await import('/src/components/tasks/task-workspace.css'); await import('/src/components/tasks/project-queue.css');
const {useThemeStore}=await import('/src/stores/themeStore.ts'); const theme=useThemeStore.getState(); theme.setAppTheme({...theme.appTheme,appearance:'manual',isDark:window.fixture.dark});
const {CoordinationDecisions}=await import('/src/components/tasks/CoordinationDecisions.tsx'); const {CoordinationAutomation}=await import('/src/components/tasks/CoordinationAutomation.tsx');
const project={id:'p',name:'Fixture',path:'C:/fixture',preferences:{verifyCommand:'node check.mjs'}};
const initial={items:[{id:'a',title:'Implement API'},{id:'b',title:'Build client'}],agreements:[{id:'interface',projectId:'p',taskId:'a',kind:'interface',resource:'Search response',text:'Return a stable identifier for each result.',paths:[],participants:['b'],acceptedBy:[],status:'pending',revision:3}],scopeAudits:[{projectId:'p',taskId:'a',runId:'run-a',tree:'current-tree',outside:['src/shared/search.ts'],overlaps:[],error:null,acceptedTree:null}],assistPolicies:[],reconciliations:[]};
function App(){const [queue,setQueue]=React.useState(initial);const act=async(command,args)=>{window.fixture.calls.push({command,args});if(command==='queue_reconcile_scope')setQueue(q=>({...q,scopeAudits:q.scopeAudits.map(a=>({...a,acceptedTree:args.tree}))}));if(command==='queue_cancel_agreement')setQueue(q=>({...q,agreements:q.agreements.map(a=>({...a,status:'canceled'}))}));if(command==='queue_assist_policy')setQueue(q=>({...q,assistPolicies:[args.policy]}));};return React.createElement('main',{className:'task-page queue-page'},React.createElement('p',null,'Browser state only; no native tasks launched.'),React.createElement('h1',null,'Coordination & handoffs'),React.createElement(CoordinationAutomation,{project,queue,busy:false,act,onSelect:()=>{}}),React.createElement(CoordinationDecisions,{queue,projectId:'p',runs:[{id:'run-a',status:'review'}],busy:false,act}));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
</script></body></html>`,
        }),
      );
      await page.goto(`${origin}/coordination-fixture.html`);
      await page.getByRole('heading', { name: 'Coordination & handoffs' }).waitFor();
      await page.getByText('Automatic coordination', { exact: true }).click();
      await page
        .getByRole('checkbox', { name: 'Resolve conflicts and interface decisions automatically' })
        .check();
      assert.equal(
        await page.getByRole('checkbox', { name: 'Merge verified work automatically' }).isChecked(),
        false,
      );
      await page.getByRole('checkbox', { name: 'Merge verified work automatically' }).check();
      await page
        .getByText('Review files outside the assignment or shared with another task', {
          exact: true,
        })
        .click();
      await page.getByRole('button', { name: 'Accept these extra files' }).focus();
      await page.keyboard.press('Enter');
      await page.getByText('Extra files accepted for this version.', { exact: true }).waitFor();
      await page.getByText('Resolve this decision', { exact: true }).click();
      await page.getByRole('button', { name: 'Cancel interface gate' }).focus();
      await page.keyboard.press('Enter');
      await page.getByText('Implement API · canceled', { exact: true }).waitFor();
      const calls = await page.evaluate(() => window.fixture.calls);
      assert.deepEqual(calls.find((call) => call.command === 'queue_reconcile_scope').args, {
        runId: 'run-a',
        tree: 'current-tree',
      });
      assert.deepEqual(calls.find((call) => call.command === 'queue_cancel_agreement').args, {
        id: 'interface',
        revision: 3,
      });
      assert.equal(
        calls.filter((call) => call.command === 'queue_assist_policy').at(-1).args.policy.merge,
        true,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({
        path: `${output}/${width}-${dark ? 'dark' : 'light'}.png`,
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
  console.log(
    'Coordination browser fixtures passed: both sizes/themes, reduced motion, keyboard actions, exact revisions and snapshot acceptance. No native tasks launched.',
  );
} finally {
  await browser.close();
}
