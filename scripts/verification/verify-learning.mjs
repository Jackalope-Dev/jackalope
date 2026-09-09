import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const origin = process.env.LEARNING_PREVIEW_URL ?? 'http://127.0.0.1:5379';
const output = 'output/playwright/automatic-learning';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
try {
  for (const width of [1280, 960]) {
    for (const isDark of [false, true]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 960 ? 640 : 840 },
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(
        ({ isDark }) => {
          window.fixture = {
            isDark,
            fail: false,
            saves: 0,
            navigated: null,
            entry: {
              id: 'lesson',
              projectId: 'fixture',
              projectPath: 'C:/fixture',
              kind: 'memory',
              title: 'User preference',
              content:
                'Previously requested by the user: Always preserve keyboard focus in dialogs.',
              keywords: ['keyboard', 'focus', 'dialogs'],
              enabled: true,
              sourceRunId: 'one',
              revision: 1,
              updatedAt: '2026-09-09',
              automatic: {
                kind: 'preference',
                managed: true,
                evidence: ['Task one: Always preserve keyboard focus in dialogs.'],
              },
            },
          };
          window.__TAURI_INTERNALS__ = {
            invoke: async (command, args) => {
              if (command === 'knowledge_list') {
                if (window.fixture.fail) throw new Error('Fixture knowledge read failed');
                return [window.fixture.entry];
              }
              if (command === 'knowledge_save') {
                window.fixture.entry = { ...args.entry, revision: args.entry.revision + 1 };
                window.fixture.saves++;
                return window.fixture.entry;
              }
              return null;
            },
          };
          window.addEventListener('jackalope:navigate', (event) => {
            window.fixture.navigated = event.detail;
          });
        },
        { isDark },
      );
      await page.route(`${origin}/learning-fixture.html`, (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html><head><meta charset="utf-8"><title>Learning browser fixture</title></head><body><p>Browser state only; no native tasks launched.</p><div id="root"></div><script type="module">
        import RefreshRuntime from '/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
        const {default: React} = await import('/node_modules/.vite/deps/react.js');
        const {default: ReactDOM} = await import('/node_modules/.vite/deps/react-dom_client.js');
        await import('/src/index.css'); await import('/src/components/ui/experience.css'); await import('/src/components/tasks/task-workspace.css');
        const {useThemeStore} = await import('/src/stores/themeStore.ts');
        const theme = useThemeStore.getState(); if (!localStorage.getItem('fixture-theme-set')) { theme.setAppTheme({...theme.appTheme, appearance:'manual',isDark:window.fixture.isDark}); localStorage.setItem('fixture-theme-set', 'yes'); }
        const {useProjectStore} = await import('/src/stores/projectStore.ts');
        const {useExecutionStore} = await import('/src/stores/executionStore.ts');
        useProjectStore.setState({projects:[{id:'fixture',name:'Fixture project',path:'C:/fixture',gitBranch:'main',worktrees:[],agentProvider:'codex'}],activeProjectId:'fixture'});
        const run = {id:'one', taskId:'one', projectId:'fixture',projectPath:'C:/fixture',projectName:'Fixture project',prompt:'Fix dialog keyboard focus',agent:'codex',status:'review',startedAt:'2026-09-09T12:00:00Z',endedAt:'2026-09-09T12:01:00Z',usage:{input:0,output:0,reported:false},contextReceipt:{entries:[window.fixture.entry]},contract:{requirements:[{id:'focus',title:'Keyboard focus returns',checkpoint:false,receipt:{accepted:false,note:'Return focus to the trigger after closing.',tree:'abc',recordedAt:'2026-09-09'}}]}};
        window.fixture.run = run; useExecutionStore.setState({runs:[run],loading:false,error:null,historyError:null,refresh:async()=>useExecutionStore.setState({historyError:null})});
        const {UsageDashboard} = await import('/src/components/tasks/UsageDashboard.tsx');
        const {ArcColorPicker} = await import('/src/components/theme/ArcColorPicker.tsx'); ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.Fragment, null, React.createElement(ArcColorPicker,{scope:'app'}), React.createElement(UsageDashboard,{view:'analytics',onTask:()=>{}})));
      </script></body></html>`,
        }),
      );
      await page.goto(`${origin}/learning-fixture.html`);
      await page.getByRole('heading', { name: 'Performance & insights', exact: true }).waitFor();
      assert.equal(await page.getByText('Hours Saved', { exact: true }).count(), 0);
      await page.getByRole('combobox', { name: 'Project', exact: true }).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('option', { name: 'Fixture project' }).click();
      const edit = page.getByRole('button', { name: 'Edit lesson', exact: true });
      await edit.waitFor();
      await edit.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.textContent === 'Edit lesson');
      assert(await edit.evaluate((el) => el === document.activeElement), 'Editor focus return');
      await edit.click();
      await page.getByRole('checkbox', { name: 'Available for future tasks' }).uncheck();
      await page.getByRole('button', { name: 'Save lesson', exact: true }).click();
      await page.getByText(/Paused · Supplied/).waitFor();
      assert.equal(await page.evaluate(() => window.fixture.saves), 1);
      await page.getByText('Source evidence and matching', { exact: true }).click();
      await page.getByRole('button', { name: 'Open source task', exact: true }).click();
      assert.equal(await page.evaluate(() => window.fixture.navigated), 'kanban');
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Horizontal overflow',
      );
      await page.screenshot({
        path: `${output}/${width}-${isDark ? 'dark' : 'light'}.png`,
        fullPage: true,
      });
      await page.evaluate(async () => {
        const { useExecutionStore } = await import('/src/stores/executionStore.ts');
        useExecutionStore.setState({ runs: [] });
      });
      await page.getByText('Not measured', { exact: true }).waitFor();
      await page.getByText(/No findings in this view/).waitFor();
      await page.evaluate(async () => {
        window.fixture.fail = true;
        const { useExecutionStore } = await import('/src/stores/executionStore.ts');
        useExecutionStore.setState({ runs: [window.fixture.run] });
      });
      await page.getByText(/Fixture knowledge read failed/).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Edit lesson', exact: true }).count(), 0);
      await page.evaluate(() => {
        window.fixture.fail = false;
      });
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await edit.waitFor();
      await page.evaluate(async () => {
        const { useExecutionStore } = await import('/src/stores/executionStore.ts');
        useExecutionStore.setState({ historyError: 'Fixture history read failed' });
      });
      await page.getByText('Fixture history read failed', { exact: false }).waitFor();
      await page.getByRole('button', { name: 'Reload history', exact: true }).click();
      await edit.waitFor();
      const color = () =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--color-bg'),
        );
      const before = await color();
      const picker = page.getByRole('button', { name: 'Personalize your workspace' });
      await picker.click();
      await page.getByRole('radio', { name: isDark ? 'Light' : 'Dark', exact: true }).focus();
      await page.keyboard.press('Space');
      assert.notEqual(await color(), before);
      await page.keyboard.press('Escape');
      assert.equal(await color(), before);
      await picker.click();
      await page.getByRole('radio', { name: isDark ? 'Light' : 'Dark', exact: true }).focus();
      await page.keyboard.press('Space');
      await page.getByRole('button', { name: 'Keep theme', exact: true }).click();
      const kept = await color();
      await page.reload();
      await page.getByRole('heading', { name: 'Performance & insights', exact: true }).waitFor();
      assert.equal(await color(), kept, 'Appearance persisted after reload');
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    'Browser fixtures passed: light/dark, 1280x840 and 960x640, reduced motion, project filter, empty history, read-error recovery, theme rollback/persistence, lesson pause/save, source navigation, keyboard and editor focus return. No native tasks launched.',
  );
} finally {
  await browser.close();
}
