import assert from 'node:assert/strict';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const html = 'apps/desktop/.settings-sync-fixture.html';
const entry = 'apps/desktop/.settings-sync-fixture.tsx';
if (existsSync(html) || existsSync(entry))
  throw Error('Inspect the existing settings sync fixture before retrying.');
mkdirSync('output/settings-sync', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  writeFileSync(
    html,
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.settings-sync-fixture.tsx"></script></body></html>',
  );
  writeFileSync(
    entry,
    `import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {OnboardingFlow} from './src/components/onboarding/OnboardingFlow';
import {PrivacySettings} from './src/components/settings/PrivacySettings';
import {ArcColorPicker} from './src/components/theme/ArcColorPicker';
import {useSettingsSyncStore,observeSettingsSync} from './src/stores/settingsSyncStore';
import {useSettingsStore} from './src/stores/settingsStore';
import {useThemeStore} from './src/stores/themeStore';
import {useOnboardingStore} from './src/stores/onboardingStore';
import './src/index.css';
import './src/components/settings/settings.css';
import './src/components/ui/experience.css';
window.fixture={account:'disconnected',enabled:false,revision:1,settings:{version:1,accentHex:'#6366f1',isDark:true,appearance:'manual',atmosphere:12,harmony:'single',mascotReactions:true,notifications:'none',osNotifications:true},calls:[],fail:false};
window.syncStore=useSettingsSyncStore;window.settingsStore=useSettingsStore;window.themeStore=useThemeStore;
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>0,unregisterCallback:()=>{},invoke:async(command,args)=>{
 const f=window.fixture;f.calls.push(command+':'+(args?.action?.action??''));
 const status=()=>({state:f.account,email:f.account==='connected'?'fixture@example.invalid':null,userCode:'ABCD1234',expiresAt:Date.now()+600000});
 if(command==='app_execution_access')return {required:true,allowed:f.account==='connected'};
 if(command==='app_account_status'||command==='app_account_poll')return status();
 if(command==='app_account_connect'){f.account='waiting';return status();}
 if(command==='app_account_referrals')return {limit:5,remaining:5,accepted:0,downloaded:0,connected:0,shareUrl:'',invites:[]};
 if(command==='app_community_settings'||command==='app_community_configure')return {reviewed:true,telemetry:false,errors:false,configured:false,buildChannel:'beta'};
 if(command==='app_settings_sync'){
   const a=args.action;const view=()=>({available:f.account==='connected',enabled:f.enabled,owner:f.account==='connected'?'fixture-owner':null,revision:f.revision,settings:f.settings,conflict:false});
   if(a.action==='status')return view();
   if(f.fail)throw Error('Fixture offline');
   if(a.action==='configure'){f.enabled=a.enabled;return view();}
   if(a.action==='delete'){f.enabled=false;f.revision=0;f.settings=null;return view();}
   if(!f.enabled)throw Error('Sync is off');
   if(a.action==='read'&&f.pause){await new Promise(resolve=>window.finishRead=resolve);f.pause=false;}
   if(a.action==='write'){if(a.revision!==f.revision)return {...view(),conflict:true};f.revision++;f.settings=a.settings;}
   return view();
 }
 return null;
}};
function Fixture(){const [settings,showSettings]=useState(false);window.showSettings=()=>showSettings(true);useEffect(observeSettingsSync,[]);return settings?<main style={{padding:32,maxWidth:850,margin:'auto'}}><h1>Privacy</h1><ArcColorPicker/><PrivacySettings/></main>:<OnboardingFlow onFinish={()=>{}} onSkip={()=>{}}/>;}
useOnboardingStore.getState().begin();createRoot(document.getElementById('root')).render(<Fixture/>);`,
  );
  for (const width of [1280, 960]) {
    for (const dark of [false, true]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 1280 ? 840 : 640 },
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('http://127.0.0.1:5179/.settings-sync-fixture.html');
      await page.getByRole('heading', { name: 'Connect your account' }).waitFor();
      assert(await page.getByRole('button', { name: 'Continue after approval' }).isDisabled());
      await page.evaluate(
        (dark) =>
          window.themeStore
            .getState()
            .setAppTheme({ ...window.themeStore.getState().appTheme, isDark: dark }),
        dark,
      );
      await page.getByRole('button', { name: 'Connect account', exact: true }).click();
      await page
        .getByText('Your email is verified. Early access is still waiting for approval.')
        .waitFor();
      assert(await page.getByRole('button', { name: 'Continue after approval' }).isDisabled());
      await page.evaluate(() => {
        window.fixture.account = 'connected';
      });
      await page.getByText('Early access approved', { exact: true }).waitFor();
      const disclosure = page.locator('summary').filter({ hasText: 'Manage privacy settings' });
      await disclosure.focus();
      await page.keyboard.press('Enter');
      const toggle = page.getByRole('switch', { name: 'Sync settings with my account' });
      await toggle.waitFor();
      assert.equal(await toggle.getAttribute('aria-checked'), 'false');
      await page.screenshot({
        path: `output/settings-sync/onboarding-${width}-${dark ? 'dark' : 'light'}.png`,
        fullPage: true,
      });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await toggle.focus();
      await page.keyboard.press('Space');
      await page.getByText('Settings are synced.', { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() => window.settingsStore.getState().notifications),
        'none',
      );
      await page.evaluate(async () => {
        window.settingsStore.getState().updateSettings({ notifications: 'failures-only' });
        window.fixture.settings = { ...window.fixture.settings, atmosphere: 50 };
        window.fixture.revision++;
        await window.syncStore.getState().refresh();
      });
      await page.getByRole('button', { name: 'Use this desktop’s settings' }).click();
      await page.getByText('Settings are synced.', { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() => window.fixture.settings.notifications),
        'failures-only',
      );
      await page.evaluate(async () => {
        window.fixture.pause = true;
        window.fixture.settings = { ...window.fixture.settings, notifications: 'all' };
        window.fixture.revision++;
        void window.syncStore.getState().refresh();
      });
      await page.waitForFunction(() => typeof window.finishRead === 'function');
      await toggle.click();
      await page.evaluate(() => window.finishRead());
      await page.waitForFunction(() => !window.syncStore.getState().busy);
      assert.equal(
        await page.evaluate(() => window.settingsStore.getState().notifications),
        'failures-only',
      );
      assert.equal(await toggle.getAttribute('aria-checked'), 'false');
      const reads = await page.evaluate(
        () => window.fixture.calls.filter((c) => c === 'app_settings_sync:read').length,
      );
      await page.evaluate(async () => {
        await window.syncStore.getState().refresh();
      });
      assert.equal(
        await page.evaluate(
          () => window.fixture.calls.filter((c) => c === 'app_settings_sync:read').length,
        ),
        reads,
      );
      await disclosure.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('heading', { name: 'Choose your theme' }).waitFor();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.getByRole('heading', { name: 'Connect your account' }).waitFor();
      await page.evaluate(() => window.showSettings());
      await page.getByRole('heading', { name: 'Privacy', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Delete synced settings' }).click();
      await page.waitForFunction(() => !window.syncStore.getState().busy);
      assert.equal(await page.evaluate(() => window.fixture.settings), null);
      assert.equal(
        await page.evaluate(() => window.settingsStore.getState().notifications),
        'failures-only',
      );
      assert.equal(await toggle.getAttribute('aria-checked'), 'false');
      await page.evaluate(
        (dark) =>
          window.themeStore
            .getState()
            .setAppTheme({ ...window.themeStore.getState().appTheme, isDark: dark }),
        dark,
      );
      await page.screenshot({
        path: `output/settings-sync/privacy-${width}-${dark ? 'dark' : 'light'}.png`,
        fullPage: true,
      });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const before = await page.evaluate(() => window.themeStore.getState().appTheme.isDark);
      await page.getByRole('button', { name: 'Personalize your workspace' }).click();
      await page.getByRole('radio', { name: dark ? 'Light' : 'Dark', exact: true }).focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => window.themeStore.getState().appTheme.isDark), before);
      assert.equal(await page.evaluate(() => window.themeStore.getState().previewing), false);
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
  console.log(
    'Browser fixtures passed: account/waitlist gating, privacy keyboard controls, restore/conflict, in-flight opt-out, deletion, theme rollback and overflow at both sizes/appearances. No live account or native execution was exercised.',
  );
} finally {
  await browser.close();
  if (existsSync(html)) unlinkSync(html);
  if (existsSync(entry)) unlinkSync(entry);
}
