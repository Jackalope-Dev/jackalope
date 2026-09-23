import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { accessEmail } from '../../apps/server/src/access/mail-templates.ts';

const html = 'apps/desktop/.feedback-fixture.html';
const entry = 'apps/desktop/.feedback-fixture.tsx';
if (existsSync(html) || existsSync(entry))
  throw Error('A feedback fixture already exists. Inspect it before retrying.');
mkdirSync('output/feedback-invitations', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
try {
  writeFileSync(
    html,
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.feedback-fixture.tsx"></script></body></html>',
  );
  writeFileSync(
    entry,
    `import React from 'react';
import {createRoot} from 'react-dom/client';
import {FeedbackTouchpoint} from './src/components/tasks/FeedbackTouchpoint';
import {FeedbackPreferences} from './src/components/settings/FeedbackPreferences';
import {useFeedbackStore} from './src/stores/feedbackStore';
import {useCommunityStore} from './src/stores/communityStore';
import {useExecutionStore} from './src/stores/executionStore';
import {useThemeStore} from './src/stores/themeStore';
import './src/index.css';
import './src/components/settings/settings.css';
import './src/components/tasks/task-workspace.css';
import './src/components/ui/experience.css';
let sample={enabled:false,promptsEnabled:true,completed:false,nextPromptAt:0,promptCount:0,eligible:false,claimed:false};
window.calls=[];
window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
  window.calls.push({command,args});
  if(command==='app_submit_feedback')return args.request.id;
  const action=args.action;
  sample={...sample,claimed:false};
  if(action.action==='activity')sample.eligible=true;
  if(action.action==='claim'){sample.eligible=false;sample.claimed=true;sample.promptCount++;}
  if(action.action==='preferences')sample={...sample,enabled:action.enabled,promptsEnabled:action.promptsEnabled};
  if(action.action==='later')sample={...sample,nextPromptAt:Date.now()+14*86400000,eligible:false};
  if(action.action==='stop')sample={...sample,enabled:false,promptsEnabled:false,eligible:false};
  if(action.action==='completed')sample={...sample,completed:true,eligible:false};
  return sample;
}};
useCommunityStore.setState({settings:{reviewed:true,telemetry:false,errors:false,configured:true,buildChannel:'beta'}});
window.fixtureTheme=useThemeStore;
window.fixtureFeedback=useFeedbackStore;
window.fixtureExecution=useExecutionStore;
document.body.style.cssText='background:var(--color-bg);color:var(--color-text-primary);padding:32px';
createRoot(document.getElementById('root')).render(<div style={{maxWidth:780,margin:'auto'}}><h1 style={{fontSize:28}}>Task result · browser fixture</h1><p style={{margin:'24px 0'}}>A finished result with recorded checks. This fixture does not execute a task.</p><FeedbackTouchpoint runId="fixture-result" paused={false}/><div style={{marginTop:40}}><FeedbackPreferences/></div></div>);`,
  );
  for (const viewport of [
    { width: 1280, height: 840 },
    { width: 960, height: 640 },
  ]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install();
    await page.goto('http://127.0.0.1:5297/.feedback-fixture.html');
    await page.getByRole('heading', { name: 'Help shape Jackalope' }).waitFor();
    await page.evaluate(() => window.fixtureExecution.setState({ runs: [{ status: 'running' }] }));
    await page.clock.fastForward(16000);
    assert.equal(
      await page.getByRole('button', { name: 'Share thoughts', exact: true }).count(),
      0,
    );
    await page.evaluate(() => window.fixtureExecution.setState({ runs: [] }));
    await page.clock.fastForward(16000);
    await page.getByRole('button', { name: 'Share thoughts', exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.evaluate(() => window.fixtureExecution.setState({ runs: [{ status: 'running' }] }));
    await page
      .getByRole('button', { name: 'Share thoughts', exact: true })
      .waitFor({ state: 'hidden' });
    await page.evaluate(() => window.fixtureExecution.setState({ runs: [] }));
    await page.getByRole('button', { name: 'Share thoughts', exact: true }).waitFor();
    for (const dark of [false, true]) {
      await page.evaluate((dark) => {
        const s = window.fixtureTheme;
        s.getState().setTheme({ ...s.getState().currentTheme, isDark: dark, appearance: 'manual' });
      }, dark);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({
        path: `output/feedback-invitations/desktop-${viewport.width}-${dark ? 'dark' : 'light'}.png`,
        fullPage: true,
      });
    }
    const share = page.getByRole('button', { name: 'Share thoughts', exact: true });
    await share.focus();
    assert.notEqual(await share.evaluate((el) => getComputedStyle(el).outlineStyle), 'none');
    await page.keyboard.press('Enter');
    await page
      .getByRole('textbox', { name: 'What would you like us to know?' })
      .fill('Review is useful. I would like clearer recovery steps.');
    const kind = page.getByRole('combobox');
    await kind.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.clock.runFor(100);
    assert(await kind.evaluate((el) => el === document.activeElement));
    await page.getByRole('button', { name: 'Review submission' }).click();
    await page.getByRole('button', { name: 'Send to Jackalope', exact: true }).click();
    await page.getByText('Thanks. Your feedback is in our private inbox.').waitFor();
    const calls = await page.evaluate(() => window.calls);
    assert.equal(calls.filter((call) => call.command === 'app_submit_feedback').length, 1);
    assert(calls.some((call) => call.args?.action?.action === 'completed'));
    await context.close();
  }
  for (const viewport of [
    { width: 1280, height: 840 },
    { width: 960, height: 640 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    let completed = false,
      unsubscribed = false,
      attempts = 0;
    const requests = [];
    await page.route('https://feedback-fixture.invalid/v1/access/feedback', async (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': 'http://127.0.0.1:5296',
            'access-control-allow-credentials': 'true',
            'access-control-allow-headers': 'content-type',
            'access-control-allow-methods': 'POST,OPTIONS',
          },
        });
      const body = route.request().postDataJSON();
      requests.push(body);
      const headers = {
        'access-control-allow-origin': 'http://127.0.0.1:5296',
        'access-control-allow-credentials': 'true',
      };
      if (body.action === 'submit') {
        attempts++;
        if (attempts === 1)
          return route.fulfill({ status: 503, headers, json: { error: 'fixture_outage' } });
        completed = true;
      }
      if (body.action === 'unsubscribe') unsubscribed = true;
      return route.fulfill({ headers, json: { completed, unsubscribed } });
    });
    await page.goto(`http://127.0.0.1:5296/feedback/#token=${'a'.repeat(64)}`);
    await page.getByRole('textbox', { name: 'What would you like us to know?' }).waitFor();
    assert(!page.url().includes('#'));
    assert.equal(
      requests.filter((r) => r.action === 'submit' || r.action === 'unsubscribe').length,
      0,
    );
    for (const dark of [false, true]) {
      const button = page.getByRole('button', {
        name: `Switch to ${dark ? 'dark' : 'light'} appearance`,
      });
      if (await button.count()) await button.click();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({
        path: `output/feedback-invitations/web-${viewport.width}-${dark ? 'dark' : 'light'}.png`,
        fullPage: true,
      });
    }
    await page
      .getByRole('textbox', { name: 'What would you like us to know?' })
      .fill('Please make task recovery clearer. <script>Never execute feedback</script>');
    await page.getByRole('button', { name: 'Review feedback', exact: true }).click();
    await page.getByRole('button', { name: 'Send to Jackalope', exact: true }).click();
    await page.getByRole('alert').waitFor();
    await page.getByRole('button', { name: 'Send to Jackalope', exact: true }).click();
    await page.getByRole('heading', { name: 'Thanks for helping shape Jackalope.' }).waitFor();
    const sent = requests.filter((r) => r.action === 'submit');
    assert.equal(sent.length, 2);
    assert.equal(sent[0].id, sent[1].id);
    await page.goto(`http://127.0.0.1:5296/feedback/#unsubscribe=${'a'.repeat(64)}`);
    const stop = page.getByRole('button', { name: 'Stop feedback emails', exact: true });
    await stop.waitFor();
    await stop.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('status').filter({ hasText: 'Feedback emails are off.' }).waitFor();
    await context.close();
  }
  assert.deepEqual(errors, []);
  const email = accessEmail(
    { to: 'fixture@example.invalid', kind: 'feedback_request', token: 'a'.repeat(64) },
    'https://jackalope.dev',
  );
  writeFileSync('output/feedback-invitations/email.html', email.body);
  for (const width of [640, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.route('https://jackalope.dev/icon-128.png', (route) =>
      route.fulfill({ path: 'apps/desktop/src-tauri/icons/128x128.png', contentType: 'image/png' }),
    );
    await page.setContent(email.body);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({
      path: `output/feedback-invitations/email-${width}.png`,
      fullPage: true,
    });
    await page.close();
  }
  const admin = readFileSync('apps/server/src/access/admin-page.ts', 'utf8');
  const script = admin.match(/<script nonce="\$\{nonce\}">([\s\S]*?)<\/script>/)?.[1];
  if (script) new Function(script);
  console.log(
    'Feedback fixtures passed: desktop 1280/960, website 1280/960/390, light/dark, reduced motion, keyboard/focus, safe preview, retry idempotency, explicit unsubscribe, and overflow. No native execution or email delivery claimed.',
  );
} finally {
  await browser.close();
  if (existsSync(html)) unlinkSync(html);
  if (existsSync(entry)) unlinkSync(entry);
}
