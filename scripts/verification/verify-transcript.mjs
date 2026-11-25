import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

// Renders a conversation with thousands of messages from fixtures and reports DOM size,
// initial render time and frame timings while scrolling and streaming. Unless
// --measure-only is given, it also checks following, Jump to latest and find.
const measureOnly = process.argv.includes('--measure-only');
const label = process.argv.find((arg) => arg.startsWith('--label='))?.slice(8) ?? 'current';
const count = Number(process.argv.find((arg) => arg.startsWith('--count='))?.slice(8) ?? 2000);
const directory = path.resolve('apps/desktop/scratch/transcript-ui');
const output = path.resolve('output/playwright/transcript');
mkdirSync(directory, { recursive: true });
mkdirSync(output, { recursive: true });
writeFileSync(
  path.join(directory, 'index.html'),
  '<div id="root"></div><script type="module" src="./fixture.tsx"></script>',
);
writeFileSync(
  path.join(directory, 'fixture.tsx'),
  `
import React, {useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {applyThemeTokens,DEFAULT_THEME} from '@jackalope/brand/theme';
import {LiveSessionView} from '../../src/components/sessions/LiveSessionView';
import {useLiveSessionStore} from '../../src/stores/liveSessionStore';
import {useProjectStore} from '../../src/stores/projectStore';
import {expandCompactRuns} from '../../src/lib/session-replies';
import '../../src/index.css';
const params=new URLSearchParams(location.search);
const count=Number(params.get('count')??2000);
const fence=String.fromCharCode(96).repeat(3);
const lorem='The change keeps keyboard focus on the trigger, narrows the retry window and records the outcome so the next attempt can resume where this one stopped.';
const reply=i=>['## Reply '+i,...Array.from({length:i%4+1},(_,p)=>lorem+' Paragraph '+p+' of reply '+i+'.'),...(i%3===0?[fence+'ts\\nexport const value'+i+' = '+i+';\\nconsole.log(value'+i+');\\n'+fence]:[]),...(i%5===0?['- First point for '+i+'\\n- Second point\\n- Third point']:[]),...(i===1234?['The needle-1234 answer.']:[]),...(i%400===7?['A zebra crossing.']:[])].join('\\n\\n');
const at=i=>new Date(Date.UTC(2026,8,1)+i*60000).toISOString();
const base={taskId:'task',liveSessionId:'session',projectId:'atlas',projectName:'Atlas',projectPath:'/fixture/atlas',workspace:'/fixture/atlas-session',branch:'session/atlas',targetBranch:'main',baseHead:'base',agent:'codex',account:'Personal',prompt:'Fixture',sessionId:'provider',activity:[],diagnostics:[],prompts:[],error:null,persistenceError:null,exitCode:0,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,reported:false}};
// As the native snapshot sends them: the newest 40 replies in full, older ones left out.
const full=new Map(Array.from({length:count},(_,i)=>['r'+i,reply(i)]));
// Older runs arrive trimmed, as compactRuns, and are filled out by the store.
const runs=Array.from({length:count},(_,i)=>i<count-40?expandCompactRuns([{id:'r'+i,taskId:'task',liveSessionId:'session',projectId:'atlas',agent:'codex',status:'review',startedAt:at(i),endedAt:at(i),resultOmitted:true,resultChars:reply(i).length,usage:base.usage}])[0]:({...base,id:'r'+i,status:'review',startedAt:at(i),endedAt:at(i),result:reply(i)}));
const messages=Array.from({length:count},(_,i)=>({id:'m'+i,text:'Message '+i+': please look at '+(i%7===0?'the zebra list and ':'')+'item '+i+'.',createdAt:at(i),runId:'r'+i,canceled:false}));
const batches=runs.map((run,i)=>({runId:run.id,messageIds:['m'+i],previousRunId:i?'r'+(i-1):null,error:null,settled:true}));
const session={id:'session',title:'Long transcript',request:{projectId:'atlas',projectName:'Atlas',projectPath:'/fixture/atlas',agent:'codex'},createdAt:at(0),updatedAt:at(count),paused:false,closed:false,pinned:false,draft:{text:'',revision:0},error:null,messages,batches};
const f=window.transcriptFixture={calls:[],longTasks:[]};
new PerformanceObserver(list=>f.longTasks.push(...list.getEntries().map(entry=>({start:entry.startTime,duration:entry.duration})))).observe({type:'longtask',buffered:true});
f.storeRuns=()=>useLiveSessionStore.getState().runs;
f.unload=()=>useLiveSessionStore.setState(s=>({runs:s.runs.map((run,i)=>i<count-40&&run.result?{...run,result:'',resultOmitted:true,resultChars:run.result.length}:run)}));
f.session=changes=>useLiveSessionStore.setState(s=>({sessions:s.sessions.map(item=>({...item,...changes(item)}))}));
f.runs=changes=>useLiveSessionStore.setState(s=>({runs:changes(s.runs)}));
f.startReply=()=>{const i=useLiveSessionStore.getState().sessions[0].messages.length;f.session(s=>({messages:[...s.messages,{id:'m'+i,text:'Message '+i+': stream a reply.',createdAt:at(i),runId:'r'+i,canceled:false}],batches:[...s.batches,{runId:'r'+i,messageIds:['m'+i],previousRunId:null,error:null,settled:false}]}));f.runs(r=>[...r,{...base,id:'r'+i,status:'running',startedAt:at(i),endedAt:null,result:'Starting'}]);return 'r'+i;};
f.append=(id,text)=>f.runs(r=>r.map(run=>run.id===id?{...run,result:run.result+text}:run));
f.finish=id=>f.runs(r=>r.map(run=>run.id===id?{...run,status:'review',endedAt:new Date().toISOString()}:run));
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={transformCallback:()=>0,metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},invoke:async(command,args={})=>{
f.calls.push({command,args});
if(command==='live_session_send'){const s=useLiveSessionStore.getState().sessions[0];f.session(item=>({messages:[...item.messages,{id:args.messageId,text:args.text,createdAt:new Date().toISOString(),runId:null,canceled:false}],draft:{text:'',revision:item.draft.revision+1}}));return {text:'',revision:s.draft.revision+1};}
if(command==='live_session_results'){if(f.failResults)throw new Error('The saved reply could not be read.');f.pages=(f.pages??0)+1;return args.runIds.filter(id=>full.has(id)).slice(0,100).map(id=>({id,result:full.get(id)}));}
if(command==='live_session_search'){const q=args.query.trim().toLowerCase();const counts={};for(const [id,text] of full){const n=text.toLowerCase().split(q).length-1;if(n)counts[id]=n;}return counts;}
if(command==='live_session_draft'){const s=useLiveSessionStore.getState().sessions[0];return {text:args.text,revision:s.draft.revision+1};}
if(command==='task_rewind_preview')return {runId:args.runId,latestRunId:'r1999',turn:1980,undone:20,conversation:'codex',prompt:'Fixture'};
if(command==='desktop_attach_support')return {drag:false,pick:false,badge:false};
if(command.startsWith('plugin:event|'))return 0;
throw new Error('Not available in the transcript fixture: '+command);}};
useProjectStore.setState({projects:[{id:'atlas',name:'Atlas',path:'/fixture/atlas',gitBranch:'main',worktrees:[],preferences:{},agentProvider:'codex'}],activeProjectId:'atlas'});
useLiveSessionStore.setState({sessions:[session],runs,selectedId:'session',loading:false,refresh:async()=>{}});
applyThemeTokens({...DEFAULT_THEME,isDark:params.get('theme')!=='light'});
function Mounted(){useLayoutEffect(()=>{f.commit=performance.now()-f.start;requestAnimationFrame(()=>setTimeout(()=>{f.painted=performance.now()-f.start;}));},[]);return null;}
function Fixture(){const {sessions,runs}=useLiveSessionStore();return <main style={{height:'100vh',display:'flex',flexDirection:'column'}}><LiveSessionView session={sessions[0]} runs={runs}/><Mounted/></main>;}
f.start=performance.now();
createRoot(document.getElementById('root')).render(<Fixture/>);
`,
);

const quantile = (values, q) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const frames = (values) => ({
  frames: values.length,
  p50: Number(quantile(values, 0.5).toFixed(1)),
  p95: Number(quantile(values, 0.95).toFixed(1)),
  max: Number(Math.max(0, ...values).toFixed(1)),
  over50ms: values.filter((value) => value > 50).length,
});

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const scrollState = (page) =>
  page.evaluate(() => {
    const node = document.querySelector('.live-transcript');
    const view = node.getBoundingClientRect();
    const row = [...node.querySelectorAll('.transcript-row')].find(
      (item) => item.getBoundingClientRect().bottom > view.top + 20,
    );
    return {
      distance: node.scrollHeight - node.scrollTop - node.clientHeight,
      row: row?.dataset.index,
      rowTop: row ? row.getBoundingClientRect().top - view.top : null,
    };
  });

async function checkBehavior(page) {
  const transcript = page.locator('.live-transcript');
  const jump = page.locator('.transcript-jump');
  // Reading back while a reply streams keeps the reading position.
  const id = await page.evaluate(() => window.transcriptFixture.startReply());
  await page.waitForFunction(() => {
    const node = document.querySelector('.live-transcript');
    return node.scrollHeight - node.scrollTop - node.clientHeight < 2;
  });
  await transcript.hover();
  await page.mouse.wheel(0, -2500);
  await page.waitForTimeout(300);
  const before = await scrollState(page);
  assert.ok(before.distance > 1000, 'scrolled up to read');
  await jump.waitFor();
  assert.equal(await jump.getAttribute('aria-label'), 'Jump to latest');
  await page.evaluate(async (id) => {
    const f = window.transcriptFixture;
    for (let index = 0; index < 40; index++) {
      f.append(id, ` more streamed text ${index} arrives below the reader.`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    f.finish(id);
    f.startReply();
  }, id);
  await page.waitForTimeout(400);
  const after = await scrollState(page);
  assert.equal(after.row, before.row, 'the same row stays at the top of the view');
  assert.ok(Math.abs(after.rowTop - before.rowTop) <= 2, 'the reading position holds');
  assert.equal(
    await jump.getAttribute('aria-label'),
    'Jump to latest, 2 new items',
    'counts the new message and reply',
  );
  // Jump to latest by keyboard returns to the end and keeps focus in the transcript.
  await jump.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const node = document.querySelector('.live-transcript');
    return node.scrollHeight - node.scrollTop - node.clientHeight < 2;
  });
  await jump.waitFor({ state: 'detached' });
  assert.equal(
    await page.evaluate(() => document.activeElement?.classList.contains('live-transcript')),
    true,
  );
  // Sending a message returns to the end.
  await transcript.hover();
  await page.mouse.wheel(0, -3000);
  await jump.waitFor();
  await page
    .getByRole('textbox', { name: /message/i })
    .first()
    .fill('Back to the end please');
  await page.keyboard.press('Enter');
  await page.locator('.transcript-rows').getByText('Back to the end please').waitFor();
  await page.waitForFunction(() => {
    const node = document.querySelector('.live-transcript');
    return node.scrollHeight - node.scrollTop - node.clientHeight < 2;
  });
  await jump.waitFor({ state: 'detached' });

  // Find searches rows that are not rendered and brings the match into view.
  await transcript.focus();
  await page.keyboard.press(`${modifier}+F`);
  const field = page.getByRole('searchbox', { name: 'Find in conversation' });
  await field.waitFor();
  // The field takes focus on the frame after it opens.
  await page.waitForFunction(() => document.activeElement?.getAttribute('type') === 'search');
  assert.equal(await page.locator('[data-index="1234"]').count(), 0, 'row 1234 starts unrendered');
  await field.fill('needle-1234');
  const status = page.locator('.transcript-find-count');
  await page.waitForFunction(
    () => document.querySelector('.transcript-find-count')?.textContent === '1 of 1',
  );
  await page.waitForFunction(() => {
    const name = [...CSS.highlights.keys()].find((key) =>
      key.startsWith('transcript-match-current-'),
    );
    const current = name && CSS.highlights.get(name);
    if (!current?.size) return false;
    const [range] = current;
    const box = range.getBoundingClientRect();
    const view = document.querySelector('.live-transcript').getBoundingClientRect();
    return box.top >= view.top && box.bottom <= view.bottom;
  });
  assert.ok(await page.locator('[data-index="1234"]').count());
  // 286 messages and 5 replies mention a zebra.
  await field.fill('ZEBRA');
  await page.waitForFunction(() =>
    /of 291$/.test(document.querySelector('.transcript-find-count')?.textContent ?? ''),
  );
  // Counts for unloaded replies arrive after the local ones; wait for the start to settle.
  let first = await status.textContent();
  for (let read = 0; read < 20; read++) {
    await page.waitForTimeout(100);
    const next = await status.textContent();
    if (next === first) break;
    first = next;
  }
  await field.press('Enter');
  await page.waitForFunction(
    (first) => document.querySelector('.transcript-find-count')?.textContent !== first,
    first,
  );
  const second = await status.textContent();
  await field.press('Shift+Enter');
  await page.waitForFunction(
    (first) => document.querySelector('.transcript-find-count')?.textContent === first,
    first,
  );
  assert.notEqual(first, second);
  await page.getByRole('button', { name: 'Next match' }).click();
  await page.waitForFunction(
    (second) => document.querySelector('.transcript-find-count')?.textContent === second,
    second,
  );
  await page.screenshot({ path: path.join(output, 'find-dark-1280.png') });
  await field.press('Escape');
  await field.waitFor({ state: 'detached' });
  assert.equal(
    await page.evaluate(() => document.activeElement?.classList.contains('live-transcript')),
    true,
    'focus returns to where find opened',
  );
  await page.waitForFunction(
    () => ![...CSS.highlights.keys()].some((key) => key.startsWith('transcript-match')),
  );

  // Mod+F stays with the view in front when the conversation is hidden.
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.keyboard.press(`${modifier}+F`);
  assert.equal(await page.getByRole('search').count(), 0);
  await page.evaluate(() => {
    window.transcriptFixture.frames = [];
    // Sampled after each frame paints: what the person saw.
    const sample = () =>
      setTimeout(() => {
        const node = document.querySelector('.live-transcript');
        const rows = `${node?.querySelectorAll('.transcript-row').length}:${node?.clientHeight}`;
        window.transcriptFixture.frames.push(rows);
        if (window.transcriptFixture.frames.length < 30) requestAnimationFrame(sample);
      });
    requestAnimationFrame(sample);
  });
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await transcript.waitFor();
  await page.waitForTimeout(600);
  const shown = await page.evaluate(() => window.transcriptFixture.frames);
  assert.ok(
    !shown.some((frame) => frame.startsWith('0:') && !frame.endsWith(':0')),
    `no frame shows the conversation without its rows: ${shown.join(' ')}`,
  );

  // A selection keeps its rows rendered while they scroll out of view.
  const selected = await page.evaluate(() => {
    const node = document.querySelector('.live-transcript');
    const row = [...node.querySelectorAll('.transcript-row')].at(-2);
    const text = row.querySelector('[data-find-part="0"]');
    const range = document.createRange();
    range.selectNodeContents(text);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    return { index: row.dataset.index, text: getSelection().toString() };
  });
  await page.evaluate(() => {
    document.querySelector('.live-transcript').scrollTop = 0;
  });
  await page.waitForTimeout(300);
  assert.equal(await page.locator(`[data-index="${selected.index}"]`).count(), 1);
  assert.equal(await page.evaluate(() => getSelection().toString()), selected.text);
  await page.evaluate(() => getSelection().removeAllRanges());

  // A reply that fails to load offers Retry on its row and in the banner.
  await page.evaluate(() => {
    window.transcriptFixture.failResults = true;
    window.transcriptFixture.unload();
    const node = document.querySelector('.live-transcript');
    node.scrollTop = node.scrollHeight / 2;
  });
  const failed = page.locator('.live-reply-failed').first();
  await failed.waitFor();
  await page.getByText('The saved reply could not be read.').waitFor();
  await page.getByRole('button', { name: 'Retry loading replies' }).waitFor();
  await page.evaluate(() => {
    window.transcriptFixture.failResults = false;
  });
  await failed.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('button', { name: 'Retry loading replies' }).click();
  await page.waitForFunction(() => !document.querySelector('.live-reply-failed'));
  await page.getByText('The saved reply could not be read.').waitFor({ state: 'detached' });

  // Copy as Markdown loads every reply the snapshot left out first.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Conversation options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy conversation as Markdown' }).click();
  let copied = '';
  for (let attempt = 0; attempt < 100 && !copied; attempt++) {
    await page.waitForTimeout(100);
    copied = await page.evaluate(() => navigator.clipboard.readText());
  }
  assert.ok(copied.includes('## Reply 0\n') && copied.includes('## Reply 1999\n'));
  assert.equal(
    await page.evaluate(
      () => window.transcriptFixture.storeRuns().filter((run) => run.resultOmitted).length,
    ),
    0,
  );

  // Rewound turns collapse into one row that find leaves out and that holds its place
  // when it opens or closes, also at the end; it stays open while it scrolls away.
  await page.evaluate(() =>
    window.transcriptFixture.runs((runs) =>
      runs.map((run) => {
        const index = Number(run.id.slice(1));
        if (run.status === 'running') run = { ...run, status: 'review', endedAt: run.startedAt };
        if (index >= 1500 && index <= 1502)
          return { ...run, rewind: { rewound: { rewindId: 'rewind', at: run.startedAt } } };
        if (index === 1979)
          return { ...run, rewind: { mark: { session: 'provider', entry: 'e' } } };
        if (index === 1980)
          return {
            ...run,
            rewind: { checkpoint: { reference: 'refs/x', commit: 'c', head: 'h', tree: 't' } },
          };
        return run;
      }),
    ),
  );
  await transcript.focus();
  await page.keyboard.press(`${modifier}+F`);
  const finder = page.getByRole('searchbox', { name: 'Find in conversation' });
  await finder.fill('Message 1501:');
  await page.waitForFunction(
    () => document.querySelector('.transcript-find-count')?.textContent === 'No matches',
  );
  await finder.fill('Message 1499:');
  await page.waitForFunction(
    () => document.querySelector('.transcript-find-count')?.textContent === '1 of 1',
  );
  await finder.press('Escape');
  const group = page.locator('.transcript-row[data-key="rewound:m1500"] .rewound-turns');
  await group.waitFor();
  assert.equal(await group.locator('[data-find-part]').count(), 0, 'find skips rewound turns');
  const summary = group.locator('summary');
  await summary.scrollIntoViewIfNeeded();
  const summaryTop = () => summary.evaluate((node) => node.getBoundingClientRect().top);
  const opened = await summaryTop();
  await summary.click();
  await group.getByText('Message 1502:').waitFor();
  await page.waitForTimeout(300);
  assert.ok(Math.abs((await summaryTop()) - opened) <= 1, 'opening holds the summary in place');
  const groupHeight = await group.evaluate((node) => node.closest('.transcript-row').offsetHeight);
  assert.ok(groupHeight > 400, `the opened group is measured (${groupHeight}px)`);
  // The focused summary would keep its row rendered.
  await transcript.focus();
  await page.evaluate(() => {
    document.querySelector('.live-transcript').scrollTop = 0;
  });
  await page.waitForTimeout(300);
  assert.equal(await group.count(), 0, 'the group unmounts once far away');
  await page.keyboard.press(`${modifier}+F`);
  await finder.fill('Message 1503:');
  await finder.press('Escape');
  await group.waitFor();
  assert.equal(await group.evaluate((node) => node.open), true, 'the group stays open');
  await summary.scrollIntoViewIfNeeded();
  const closing = await summaryTop();
  await summary.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => !document.querySelector('[data-key="rewound:m1500"] .rewound-turns').open,
  );
  await page.waitForTimeout(300);
  assert.ok(Math.abs((await summaryTop()) - closing) <= 1, 'closing holds the summary in place');

  // At the end, a group that opens below the view stops following instead of scrolling it away.
  await page.evaluate(() =>
    window.transcriptFixture.runs((runs) =>
      runs.map((run) =>
        ['r1998', 'r1999'].includes(run.id)
          ? { ...run, rewind: { rewound: { rewindId: 'rewind', at: run.startedAt } } }
          : run,
      ),
    ),
  );
  await page.locator('.transcript-jump').click();
  await page.waitForFunction(() => {
    const node = document.querySelector('.live-transcript');
    return node.scrollHeight - node.scrollTop - node.clientHeight < 2;
  });
  const last = page.locator('.transcript-row[data-key="rewound:m1998"] summary');
  await last.waitFor();
  const lastTop = await last.evaluate((node) => node.getBoundingClientRect().top);
  await last.click();
  await page.waitForTimeout(400);
  assert.ok(
    Math.abs((await last.evaluate((node) => node.getBoundingClientRect().top)) - lastTop) <= 1,
    'the summary stays under the pointer at the end',
  );
  await page.locator('.transcript-jump').waitFor();
  await last.click();
  await page.waitForFunction(() => {
    const node = document.querySelector('.live-transcript');
    return node.scrollHeight - node.scrollTop - node.clientHeight < 2;
  });

  // Edit from here opens its dialog from a virtualized row; the row stays rendered while
  // the dialog is open and focus returns to it.
  const row = page.locator('.transcript-row[data-key="m1980"]');
  await page.keyboard.press(`${modifier}+F`);
  await finder.fill('Message 1980:');
  await finder.press('Escape');
  await row.waitFor();
  const edit = row.getByRole('button', { name: 'Edit from here' });
  assert.equal(await edit.evaluate((node) => getComputedStyle(node).opacity), '0');
  await edit.focus();
  await page.waitForFunction(
    (node) => getComputedStyle(node).opacity === '1',
    await edit.elementHandle(),
  );
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Edit from turn 1980?' });
  await dialog.waitFor();
  await page.evaluate(() => {
    document.querySelector('.live-transcript').scrollTop = 0;
  });
  await page.waitForTimeout(300);
  assert.equal(await row.count(), 1, 'the row behind the dialog stays rendered');
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(
    await edit.evaluate((node) => node === document.activeElement),
    true,
    'focus returns to Edit from here',
  );
}

async function checkLayout(page, name) {
  const transcript = page.locator('.live-transcript');
  await transcript.hover();
  await page.mouse.wheel(0, -1500);
  const jump = page.locator('.transcript-jump');
  await jump.waitFor();
  assert.equal(await jump.evaluate((node) => getComputedStyle(node).animationName), 'none');
  await transcript.focus();
  await page.keyboard.press(`${modifier}+F`);
  await page.getByRole('searchbox', { name: 'Find in conversation' }).fill('zebra');
  await page.waitForFunction(() =>
    /of \d+$/.test(document.querySelector('.transcript-find-count')?.textContent ?? ''),
  );
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll('.transcript-find, .transcript-jump')]
      .map((node) => node.getBoundingClientRect())
      .some((box) => box.left < 0 || box.right > width);
  });
  assert.equal(overflow, false, 'find and Jump to latest fit the window');
  await page.screenshot({ path: path.join(output, `find-${name}.png`) });
  // Jumping with reduced motion lands at once.
  await jump.click();
  assert.equal(
    await page.evaluate(() => {
      const node = document.querySelector('.live-transcript');
      return node.scrollHeight - node.scrollTop - node.clientHeight < 2;
    }),
    true,
  );
}

const server = await createServer({
  root: path.resolve('apps/desktop'),
  configFile: path.resolve('apps/desktop/vite.config.ts'),
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'warn',
});
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}/scratch/transcript-ui/index.html`;
  browser = await chromium.launch({
    channel: process.platform === 'win32' ? 'msedge' : 'chrome',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text()))
      errors.push(message.text());
  });
  page.setDefaultTimeout(60_000);
  const transcript = page.locator('.live-transcript');
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          let last = -1;
          let stable = 0;
          const check = () => {
            const markdown = document.querySelectorAll('.task-markdown').length;
            stable = markdown === last ? stable + 1 : 0;
            last = markdown;
            if (stable >= 10) resolve();
            else setTimeout(check, 50);
          };
          check();
        }),
    );
  // The first load compiles modules; measure the second.
  // Vite may reload once while it optimizes dependencies it discovers.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(`${origin}?count=${count}`);
      await transcript.waitFor();
      await settle();
      break;
    } catch (error) {
      if (!/context was destroyed|navigation/i.test(String(error))) throw error;
    }
  }
  errors.length = 0;
  await page.reload();
  await transcript.waitFor();
  await page.waitForFunction(() => window.transcriptFixture.painted !== undefined);
  await settle();
  const initial = await page.evaluate(() => {
    const node = document.querySelector('.live-transcript');
    return {
      commitMs: Math.round(window.transcriptFixture.commit),
      firstPaintMs: Math.round(window.transcriptFixture.painted),
      settledMs: Math.round(performance.now() - window.transcriptFixture.start),
      domNodes: document.getElementsByTagName('*').length,
      transcriptNodes: node.getElementsByTagName('*').length,
      formattedReplies: node.querySelectorAll('.task-markdown').length,
      longTasks: window.transcriptFixture.longTasks.length,
      atBottom: node.scrollHeight - node.scrollTop - node.clientHeight < 2,
    };
  });
  // Read back from the end with the wheel: the first row in view should move by exactly
  // the wheel distance while rows above it load, format and measure.
  const anchor = () =>
    page.evaluate(() => {
      const node = document.querySelector('.live-transcript');
      const view = node.getBoundingClientRect();
      // The first row starting inside the view: what the person is reading.
      const rows = [...node.querySelectorAll('.transcript-row')];
      const row =
        rows.find((item) => {
          const box = item.getBoundingClientRect();
          return box.top >= view.top && box.top < view.bottom;
        }) ?? rows.find((item) => item.getBoundingClientRect().bottom > view.top + 1);
      return { index: row.dataset.index, top: row.getBoundingClientRect().top, at: node.scrollTop };
    });
  const rowTop = (index) =>
    page.evaluate(
      (index) =>
        document.querySelector(`.live-transcript [data-index="${index}"]`)?.getBoundingClientRect()
          .top ?? null,
      index,
    );
  await transcript.hover();
  const jumps = [];
  for (let step = 0; step < 150; step++) {
    const before = await anchor();
    if (before.at < 400) break;
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(120);
    const after = await rowTop(before.index);
    const moved = after === null ? null : after - before.top;
    if (moved === null || Math.abs(moved - 200) > 2)
      jumps.push(moved === null ? null : Math.round(moved - 200));
  }
  const reading = { steps: 150, jumps: jumps.length, offsets: jumps };
  await page.evaluate(() => {
    const node = document.querySelector('.live-transcript');
    node.scrollTop = node.scrollHeight;
  });
  await page.waitForTimeout(300);
  // Scroll from the bottom to the top at 300px per frame, as a fast wheel would.
  const scroll = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const node = document.querySelector('.live-transcript');
        const intervals = [];
        let last = performance.now();
        let steps = 0;
        const step = (now) => {
          intervals.push(now - last);
          last = now;
          node.scrollTop -= 300;
          steps++;
          if (steps < 240 && node.scrollTop > 0) requestAnimationFrame(step);
          else resolve(intervals.slice(1));
        };
        requestAnimationFrame(step);
      }),
  );
  await page.evaluate(() => {
    const node = document.querySelector('.live-transcript');
    node.scrollTop = node.scrollHeight;
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const node = document.querySelector('.live-transcript');
    node.scrollTop = node.scrollHeight;
  });
  await page.waitForTimeout(300);
  // Stream a reply at the bottom: 200 chunks, one every 30ms.
  const stream = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const f = window.transcriptFixture;
        const node = document.querySelector('.live-transcript');
        const id = f.startReply();
        const intervals = [];
        let last = performance.now();
        let done = false;
        // Distance from the end at the start of each frame: what the last frame showed.
        let drift = 0;
        const frame = (now) => {
          intervals.push(now - last);
          last = now;
          drift = Math.max(drift, node.scrollHeight - node.scrollTop - node.clientHeight);
          if (!done) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        let chunks = 0;
        const timer = setInterval(() => {
          f.append(
            id,
            chunks % 12 === 11 ? '\n\n' : ` streamed words ${chunks} keep arriving in this reply.`,
          );
          if (++chunks === 200) {
            clearInterval(timer);
            setTimeout(() => {
              done = true;
              resolve({
                intervals: intervals.slice(1),
                atBottom: node.scrollHeight - node.scrollTop - node.clientHeight < 2,
                maxDrift: Math.round(drift),
              });
            }, 400);
          }
        }, 30);
      }),
  );
  const metrics = {
    label,
    messages: count,
    initial,
    reading,
    scroll: frames(scroll),
    stream: { ...frames(stream.intervals), atBottom: stream.atBottom, maxDrift: stream.maxDrift },
  };
  writeFileSync(
    path.join(output, `metrics-${label}.json`),
    `${JSON.stringify(metrics, null, 2)}\n`,
  );
  console.log(JSON.stringify(metrics, null, 2));
  if (!measureOnly) {
    assert.equal(initial.atBottom, true, 'opens at the latest message');
    assert.ok(initial.transcriptNodes < 3000, 'renders only rows near the viewport');
    assert.equal(stream.atBottom, true, 'follows a streaming reply');
    assert.equal(stream.maxDrift, 0, 'never shows a frame away from the end while following');
    assert.ok(reading.jumps <= 1, `reading back moved the text ${reading.jumps} times`);
    await checkBehavior(page);
    for (const [theme, width, height] of [
      ['light', 960, 640],
      ['dark', 480, 720],
    ]) {
      const narrow = await browser.newPage({
        viewport: { width, height },
        reducedMotion: 'reduce',
      });
      narrow.on('pageerror', (error) => errors.push(error.message));
      await narrow.goto(`${origin}?count=300&theme=${theme}`);
      await narrow.locator('.live-transcript').waitFor();
      await checkLayout(narrow, `${theme}-${width}`);
      await narrow.close();
    }
    assert.deepEqual(errors, []);
    console.log(
      'Transcript browser fixtures passed: bounded rendering, following, Jump to latest, send returns to the end, find across unrendered and unloaded replies, selection retention, rewound groups and Edit from here on virtualized rows, copying with replies loaded on demand, retrying failed reply loads, reduced motion and light/dark at three widths. No native execution.',
    );
  }
} finally {
  await browser?.close();
  await server.close();
}
