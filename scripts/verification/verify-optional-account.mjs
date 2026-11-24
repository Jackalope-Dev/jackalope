import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Renders the welcome screen, the workspace's account entry and suggestion, and a gated
// account feature with a fake native bridge. No account service is contacted and no
// native task runs; native tests cover local execution without an account.
const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5195';
const output = 'output/playwright/optional-account';
await mkdir(output, { recursive: true });
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {AccessBoundary,AccessNoticeSlot} from '/src/components/account/AccessBoundary.tsx';
import {ConnectAccountEntry} from '/src/components/account/AccountPrompts.tsx';
import {JackalopeAccount} from '/src/components/settings/JackalopeAccount.tsx';
import {ReferralSettings} from '/src/components/settings/ReferralSettings.tsx';
import {useAppEvent} from '/src/lib/app-events.ts';
import {useExecutionStore} from '/src/stores/executionStore.ts';
import {useOnboardingStore} from '/src/stores/onboardingStore.ts';
import {useThemeStore} from '/src/stores/themeStore.ts';
import '/src/index.css';
import '/src/components/layout/workspace-shell.css';
import '/src/components/settings/settings.css';
const disconnected={state:'disconnected',email:null,userCode:null,expiresAt:null};
const f=window.accountFixture=JSON.parse(sessionStorage.getItem('accountFixture')||'null')||{account:disconnected,waitlist:false,calls:[]};
const save=()=>sessionStorage.setItem('accountFixture',JSON.stringify(f));
f.theme=(isDark)=>{const s=useThemeStore.getState();s.setAppTheme({...s.appTheme,appearance:'manual',isDark});};
f.finishTask=()=>useExecutionStore.setState({runs:[{id:'run-1',taskId:'task-1',status:'review',projectId:'p',agent:'codex',prompt:'Fixture',createdAt:new Date().toISOString()}]});
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>0,unregisterCallback:()=>{},invoke:async(command,args={})=>{
 f.calls.push(command);save();
 if(command==='app_account_status')return f.account;
 if(command==='app_account_connect'){f.account={state:'pending',email:null,userCode:'ABCD1234',expiresAt:Date.now()+600000};save();return f.account;}
 if(command==='app_account_poll'){
  if(f.account.state==='pending')f.account=f.waitlist
   ?{state:'waiting',email:'waiting@example.invalid',userCode:null,expiresAt:Date.now()+86400000,waitlist:{position:42,referrals:3,pending:1,priorityDays:3,shareUrl:'https://jackalope.dev/?ref='+'c'.repeat(64),checkedAt:Date.now()}}
   :{state:'connected',email:'member@example.invalid',userCode:null,expiresAt:Date.now()+86400000};
  save();return f.account;}
 if(command==='app_account_disconnect'){f.account=disconnected;save();return f.account;}
 if(command==='app_account_referrals')return {limit:5,remaining:4,accepted:1,downloaded:1,connected:1,shareUrl:'https://jackalope.dev/access/?invite='+'a'.repeat(64),invites:[],openSignup:true};
 if(command==='app_community_settings'||command==='app_community_configure')return {reviewed:true,telemetry:false,errors:false,configured:false};
 if(command==='app_settings_sync')return {available:true,enabled:true,owner:null,revision:0,settings:null,conflict:false};
 if(command==='app_lesson_sync')return {available:false,enabled:false,settingsSync:false,owner:null};
 if(command==='plugin:window|is_maximized')return false;
 return null;
}};
if(!sessionStorage.getItem('fixtureStarted')){sessionStorage.setItem('fixtureStarted','1');useOnboardingStore.setState({status:'new'});}
function Workspace(){
 const [settings,setSettings]=React.useState(null);
 useAppEvent('open-settings',(category)=>setSettings(category));
 return React.createElement('div',{className:'workspace-shell',style:{display:'flex',flexDirection:'column',height:'100vh',padding:8}},
  React.createElement(AccessNoticeSlot),
  React.createElement('div',{className:'workspace-body',style:{display:'flex',gap:8,flex:1,minHeight:0}},
   React.createElement('aside',{className:'workspace-navigation',style:{width:220,display:'flex',flexDirection:'column'}},
    React.createElement('button',{type:'button',className:'workspace-nav-item'},'Inbox'),
    React.createElement(ConnectAccountEntry),
    React.createElement('button',{type:'button',className:'workspace-nav-item workspace-settings',onClick:()=>setSettings('Invitations')},'Invitations')),
   React.createElement('main',{style:{flex:1,overflow:'auto',padding:16}},
    React.createElement('h1',null,'Workspace fixture'),
    settings==='Jackalope account'&&React.createElement('section',{'aria-label':'Jackalope account settings'},React.createElement(JackalopeAccount)),
    settings==='Invitations'&&React.createElement('section',{'aria-label':'Invitations settings'},React.createElement(ReferralSettings,{onAccount:()=>setSettings('Jackalope account')})))));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AccessBoundary,null,React.createElement(Workspace)));
`;

const browser = await chromium.launch({
  channel: process.env.UI_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chrome'),
  headless: true,
});
const errors = [];
async function open(viewport = { width: 1280, height: 840 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/src/main.tsx*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fixture }),
  );
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  return page;
}
const prompts = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('jackalope-account-prompts-v1')).state);
const calls = (page) => page.evaluate(() => window.accountFixture.calls);
const noHorizontalScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

try {
  // First run: creating an account or signing in leads; continuing without one is beside it.
  const page = await open();
  const welcome = page.getByRole('heading', { name: 'Welcome to Jackalope.' });
  await welcome.waitFor();
  const primary = page.getByRole('button', { name: 'Create free account or sign in' });
  const skip = page.getByRole('button', { name: 'Continue without an account' });
  await primary.waitFor();
  await skip.waitFor();
  await page.getByText('An account adds sync across your computers').waitFor();
  for (const [width, height] of [
    [1280, 840],
    [960, 640],
    [375, 720],
  ]) {
    await page.setViewportSize({ width, height });
    for (const isDark of [false, true]) {
      await page.evaluate((dark) => window.accountFixture.theme(dark), isDark);
      await page.emulateMedia({ reducedMotion: isDark ? 'reduce' : 'no-preference' });
      assert.ok(await noHorizontalScroll(page), `welcome scrolls sideways at ${width}`);
      await page.screenshot({
        path: `${output}/welcome-${width}-${isDark ? 'dark' : 'light'}.png`,
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.locator('.access-privacy > summary').focus();
  await page.keyboard.press('Tab');
  assert.ok(await primary.evaluate((element) => element === document.activeElement));
  await page.keyboard.press('Tab');
  assert.ok(await skip.evaluate((element) => element === document.activeElement));
  await page.keyboard.press('Enter');

  // Continuing goes straight in, with no connection started or service call made.
  const workspace = page.getByRole('heading', { name: 'Workspace fixture' });
  await workspace.waitFor();
  assert.ok((await prompts(page)).skippedAt > 0);
  assert.ok(!(await calls(page)).includes('app_account_connect'));
  const entry = page.getByRole('button', { name: 'Connect account', exact: true });
  await entry.waitFor();
  assert.equal(await page.locator('.account-suggestion').count(), 0, 'no milestone yet');

  // A gated feature explains why it needs an account instead of calling the service.
  await page.getByRole('button', { name: 'Invitations' }).click();
  const gated = page.getByRole('region', { name: 'Invitations settings' });
  await gated
    .getByText('Your share link and Instant Access Passes belong to your account.', {
      exact: false,
    })
    .waitFor();
  await gated.getByRole('button', { name: 'Connect account' }).waitFor();
  assert.ok(!(await calls(page)).includes('app_account_referrals'));
  await page.screenshot({ path: `${output}/gated-invitations.png` });

  // After a finished task, the one suggestion appears; "Not now" hides it for a week.
  await page.evaluate(() => window.accountFixture.finishTask());
  const suggestion = page.locator('.account-suggestion');
  await suggestion.waitFor();
  for (const isDark of [false, true]) {
    await page.evaluate((dark) => window.accountFixture.theme(dark), isDark);
    await page.screenshot({ path: `${output}/suggestion-${isDark ? 'dark' : 'light'}.png` });
  }
  await page.setViewportSize({ width: 375, height: 720 });
  assert.ok(await noHorizontalScroll(page), 'suggestion scrolls sideways at 375');
  await page.setViewportSize({ width: 1280, height: 840 });
  await suggestion.getByRole('button', { name: 'Not now' }).click();
  await suggestion.waitFor({ state: 'detached' });
  assert.equal((await prompts(page)).suggestion, 'snoozed');
  await page.reload();
  await workspace.waitFor();
  await page.evaluate(() => window.accountFixture.finishTask());
  await page.waitForTimeout(300);
  assert.equal(await suggestion.count(), 0, 'a snoozed suggestion waits');

  // Once the snooze passes it returns a single time; a second "Not now" retires it.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('jackalope-account-prompts-v1'));
    saved.state.snoozedUntil = Date.now() - 1;
    localStorage.setItem('jackalope-account-prompts-v1', JSON.stringify(saved));
  });
  await page.reload();
  await workspace.waitFor();
  await page.evaluate(() => window.accountFixture.finishTask());
  await suggestion.waitFor();
  await suggestion.getByRole('button', { name: 'Not now' }).focus();
  await page.keyboard.press('Enter');
  await suggestion.waitFor({ state: 'detached' });
  assert.equal((await prompts(page)).suggestion, 'dismissed');
  await page.reload();
  await workspace.waitFor();
  await page.evaluate(() => window.accountFixture.finishTask());
  await page.waitForTimeout(300);
  assert.equal(await suggestion.count(), 0, 'a retired suggestion never returns');

  // The quiet sidebar entry opens the account settings, which connect in the browser.
  await entry.focus();
  await page.keyboard.press('Enter');
  const settings = page.getByRole('region', { name: 'Jackalope account settings' });
  await settings.getByText('Optional. A free account syncs', { exact: false }).waitFor();
  await settings.getByRole('button', { name: 'Connect account' }).click();
  await settings.getByText('ABCD–1234').waitFor();
  await settings.getByText('member@example.invalid').waitFor();
  await entry.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Invitations' }).click();
  await page
    .getByRole('region', { name: 'Invitations settings' })
    .getByText('Invite friends')
    .waitFor();
  assert.ok((await calls(page)).includes('app_account_referrals'));
  await page.context().close();

  // Waitlist members keep their progress on the welcome screen and can still go in.
  const waitlist = await open({ width: 960, height: 640 });
  await waitlist.evaluate(() => {
    window.accountFixture.waitlist = true;
  });
  await waitlist.getByRole('button', { name: 'Create free account or sign in' }).click();
  await waitlist.getByText('ABCD–1234').waitFor();
  await waitlist.getByRole('heading', { name: 'You’re on the list.' }).waitFor();
  assert.ok(await noHorizontalScroll(waitlist));
  await waitlist.screenshot({ path: `${output}/waitlist-960.png`, fullPage: true });
  await waitlist.getByRole('button', { name: 'Continue to Jackalope' }).click();
  await waitlist.getByRole('heading', { name: 'Workspace fixture' }).waitFor();
  assert.equal(
    await waitlist.getByRole('button', { name: 'Connect account', exact: true }).count(),
    0,
    'a waitlist connection does not ask to connect again',
  );
  await waitlist.getByRole('button', { name: 'Invitations' }).click();
  await waitlist.getByText('It opens once your account is approved.', { exact: false }).waitFor();
  await waitlist.context().close();

  // An approved connection made on the welcome screen is acknowledged, then enters.
  const member = await open();
  await member.getByRole('button', { name: 'Create free account or sign in' }).click();
  await member.getByRole('heading', { name: 'You’re in.' }).waitFor();
  await member.getByRole('heading', { name: 'Workspace fixture' }).waitFor();
  await member.context().close();

  assert.deepEqual(errors, []);
  console.log(
    'Optional account fixtures passed: welcome actions, skip without service calls, gated invitations, one-time suggestion with snooze and retirement, sidebar entry, connection, waitlist progress, themes, keyboard and narrow layouts. No account service or native execution used.',
  );
} finally {
  await browser.close();
}
