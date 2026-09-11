import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5199';
const output = 'output/playwright/task-cleanup';
await mkdir(output, { recursive: true });
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import { TaskWorkspace } from '/src/components/tasks/TaskWorkspace.tsx';
import { useExecutionStore } from '/src/stores/executionStore.ts';
import { useTaskStore } from '/src/stores/taskStore.ts';
import { useProjectStore } from '/src/stores/projectStore.ts';
import { applyThemeTokens, DEFAULT_THEME } from '/node_modules/@jackalope/brand/src/theme.ts';
import '/src/index.css';
import '/src/components/tasks/task-workspace.css';
import '/src/components/ui/experience.css';
const base = {projectId:'atlas',projectName:'Atlas',projectPath:'C:/Projects/atlas',workspace:'C:/Projects/atlas-task',branch:'task',baseHead:'base',agent:'codex',account:'Personal',prompt:'',status:'reviewed',startedAt:'2026-09-01T12:00:00Z',endedAt:'2026-09-01T13:00:00Z',sessionId:null,result:'Saved result',activity:[],diagnostics:[],error:null,persistenceError:null,exitCode:0,usage:{input:10,output:20,cacheRead:0,cacheWrite:0,reported:true}};
const tasks = [['finished','Polish search','reviewed'],['failed','Retry indexing','failed'],['active','Live indexing','running'],['interrupted','Recover indexing','interrupted'],['review','Review navigation','review'],['other','Other project work','reviewed']].map(([id,prompt,status])=>({...base,id,taskId:id,prompt,status,projectId:id==='other'?'other':'atlas',projectName:id==='other'?'Other':'Atlas'}));
const f = window.cleanupFixture = {calls:[],fail:null,hold:false,release:null,theme: mode=>applyThemeTokens({...DEFAULT_THEME,isDark:mode==='dark'})};
const save = Storage.prototype.setItem;
Storage.prototype.setItem = function(key,value) {
  if (f.failIdeaSave && key==='jackalope-tasks') throw new Error('Idea storage is full.');
  return save.call(this,key,value);
};
window.__TAURI_INTERNALS__ = {invoke:async(command,args={})=>{
  f.calls.push({command,...args});
  if(command==='queue_snapshot') return {mergedRunIds:[]};
  if(command==='task_archived_runs') return [];
  if(command==='task_set_archived') {
    if(f.hold) await new Promise(resolve=>{f.release=resolve});
    if(f.fail===args.id) throw new Error('History could not be saved.');
    useExecutionStore.setState(s=>({runs:s.runs.map(r=>r.id===args.id?{...r,archivedAt:args.archived?new Date().toISOString():null}:r)}));
    return;
  }
  throw new Error('Unexpected fixture command: '+command);
}};
useProjectStore.setState({projects:[{id:'atlas',name:'Atlas'},{id:'other',name:'Other'}],activeProjectId:null});
useTaskStore.setState({tasks:[{id:'idea',projectId:'atlas',title:'Explore shortcuts',rawPrompt:'Explore shortcuts',status:'backlog',createdAt:base.startedAt,updatedAt:base.startedAt}]});
const archiveIdea = useTaskStore.getState().setArchived;
f.ideas = () => useTaskStore.getState().tasks;
useTaskStore.setState({setArchived:(id,archived)=>{f.calls.push({command:'idea_archive',id,archived});return archiveIdea(id,archived);}});
useExecutionStore.setState({runs:tasks,runners:[],selectedId:null,loading:false,error:null,refresh:async()=>{}});
f.theme('dark');
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement('main',{style:{height:'100vh',overflow:'auto'}},React.createElement('p',null,'Browser fixture only; no native tasks launched.'),React.createElement(TaskWorkspace,{onCapture:()=>{},onSchedule:()=>{},composerVisible:false})));
`;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
try {
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.route('**/src/main.tsx*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fixture }),
  );
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('button', { name: 'Select tasks', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Archive Live indexing', exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await page.getByRole('button', { name: 'Archive Recover indexing', exact: true }).isDisabled(),
    true,
  );
  await page.getByRole('combobox', { name: 'Filter by project' }).click();
  await page.getByRole('option', { name: 'Atlas', exact: true }).click();
  await page.getByRole('button', { name: 'Archive finished (1)', exact: true }).click();
  await page.getByText('1 task archived.', { exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent === 'Select tasks');
  assert.deepEqual(
    await page.evaluate(() =>
      window.cleanupFixture.calls.filter((c) => c.command === 'task_set_archived').map((c) => c.id),
    ),
    ['finished'],
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByText('1 task restored.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Select tasks', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('checkbox', { name: 'Select Polish search', exact: true }).waitFor();
  await page.getByRole('checkbox', { name: 'Select all matching tasks', exact: true }).check();
  assert.equal(
    await page.getByRole('checkbox', { name: 'Select Live indexing', exact: true }).isChecked(),
    false,
  );
  assert.equal(
    await page.getByRole('checkbox', { name: 'Select Recover indexing', exact: true }).isChecked(),
    false,
  );
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('indexing');
  await page.evaluate(() => {
    window.cleanupFixture.fail = 'failed';
  });
  await page.getByRole('button', { name: 'Archive selected (1)', exact: true }).click();
  await page.getByText('History could not be saved.', { exact: false }).waitFor();
  assert.equal(
    await page.getByRole('checkbox', { name: 'Select Retry indexing', exact: true }).isChecked(),
    true,
  );
  await page.evaluate(() => {
    window.cleanupFixture.fail = null;
    window.cleanupFixture.hold = true;
  });
  await page.getByRole('button', { name: 'Archive selected (1)', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: 'Archived', exact: true }).isDisabled(),
    true,
  );
  await page.waitForFunction(() => !!window.cleanupFixture.release);
  await page.evaluate(() => {
    window.cleanupFixture.hold = false;
    window.cleanupFixture.release();
  });
  await page.getByText('1 task archived.', { exact: true }).waitFor();
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('');
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await page.getByRole('button', { name: 'Restore Retry indexing', exact: true }).click();
  await page.getByText('1 task restored.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Current tasks', exact: true }).click();
  await page.evaluate(() => {
    window.cleanupFixture.failIdeaSave = true;
  });
  await page.getByRole('button', { name: 'Archive Explore shortcuts', exact: true }).click();
  await page.getByText('Idea storage is full.', { exact: false }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Archive Explore shortcuts', exact: true }).count(),
    1,
  );
  await page.evaluate(() => {
    window.cleanupFixture.failIdeaSave = false;
  });
  await page.getByRole('button', { name: 'Archive Explore shortcuts', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.textContent === 'Select tasks');
  assert.ok(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('jackalope-tasks')).state.tasks[0].archivedAt,
    ),
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('jackalope-tasks')).state.tasks[0].archivedAt,
    ),
    null,
  );
  await page.getByRole('button', { name: 'Select tasks', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select all matching tasks', exact: true }).check();
  await page.evaluate(() => {
    window.cleanupFixture.fail = 'failed';
  });
  await page.getByRole('button', { name: 'Archive selected (4)', exact: true }).click();
  await page.getByText('History could not be saved.', { exact: false }).waitFor();
  assert.equal(
    await page.getByRole('checkbox', { name: 'Select Retry indexing', exact: true }).isChecked(),
    true,
  );
  assert.equal(
    await page.getByRole('checkbox', { name: 'Select Review navigation', exact: true }).count(),
    0,
  );
  await page.evaluate(() => {
    window.cleanupFixture.fail = null;
  });
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await page.getByRole('button', { name: 'Select tasks', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select all matching tasks', exact: true }).check();
  await page.getByRole('button', { name: 'Restore selected (3)', exact: true }).click();
  await page.getByText('3 tasks restored.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Current tasks', exact: true }).click();
  for (const [width, height] of [
    [1280, 840],
    [960, 640],
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => window.cleanupFixture.theme(theme), theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const layout of ['List', 'Board']) {
        await page.getByRole('button', { name: layout, exact: true }).click();
        await page.getByRole('button', { name: 'Select tasks', exact: true }).click();
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
          false,
        );
        await page.screenshot({
          path: `${output}/${theme}-${width}-${layout.toLowerCase()}.png`,
          fullPage: true,
        });
        await page.getByRole('button', { name: 'Done selecting', exact: true }).click();
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    'Task cleanup browser fixtures passed: scoped bulk actions, guarded selection, failed saves and retry, pending guards, restore, undo, saved ideas, keyboard focus, themes and responsive layouts.',
  );
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  console.error(await page.locator('body').ariaSnapshot());
  console.error(
    await page.evaluate(() => ({
      calls: window.cleanupFixture.calls,
      ideas: localStorage.getItem('jackalope-tasks'),
      memory: window.cleanupFixture.ideas(),
    })),
  );
  throw error;
} finally {
  await browser.close();
}
