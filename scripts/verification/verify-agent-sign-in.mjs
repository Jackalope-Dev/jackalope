import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const origin = process.env.SIGN_IN_PREVIEW_URL ?? 'http://127.0.0.1:5297';
const output = 'output/agent-sign-in';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const url = `https://claude.ai/oauth/authorize?state=fixture&code_challenge=${'a'.repeat(160)}`;
const errors = [];
try {
  for (const appearance of ['light', 'dark']) {
    for (const width of [1280, 960]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 960 ? 640 : 840 },
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => {
        errors.push(error.message);
        console.error(error.message);
      });
      await page.addInitScript(
        ({ url, appearance }) => {
          window.fixture = {
            chunks: [],
            opened: [],
            inputs: [],
            stopped: [],
            copied: '',
            failOpen: true,
            failCopy: false,
            appearance,
          };
          window.fixtureUrl = url;
          Object.defineProperty(navigator, 'clipboard', {
            value: {
              writeText: async (text) => {
                if (window.fixture.failCopy) throw new Error('Fixture clipboard denial');
                window.fixture.copied = text;
              },
            },
          });
          window.__TAURI_INTERNALS__ = {
            invoke: async (command, args) => {
              const state = window.fixture;
              if (command === 'agent_profile_sign_in') return 'fixture-session';
              if (command === 'agent_profile_sign_in_poll')
                return {
                  state: 'running',
                  exitCode: null,
                  truncated: false,
                  chunks: state.chunks.filter((chunk) => chunk.sequence > args.after),
                };
              if (command === 'agent_profile_sign_in_stop') state.stopped.push(args.sessionId);
              if (command === 'agent_profile_sign_in_input') state.inputs.push(args.data);
              if (command === 'plugin:shell|open') {
                state.opened.push(args.path);
                if (state.failOpen) throw new Error('Fixture browser denial');
              }
            },
          };
        },
        { url, appearance },
      );
      await page.route(`${origin}/signin-fixture.html`, (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign-in browser fixture</title></head><body><button id="opener">Open sign-in fixture</button><div id="root"></div><script type="module">
          import RefreshRuntime from '/@react-refresh';
          RefreshRuntime.injectIntoGlobalHook(window);
          window.$RefreshReg$ = () => {};
          window.$RefreshSig$ = () => (type) => type;
          window.__vite_plugin_react_preamble_installed__ = true;
          const { default: React } = await import('/node_modules/.vite/deps/react.js');
          const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
          await import('/src/index.css');
          await import('/src/components/ui/experience.css');
          await import('/src/components/tasks/task-workspace.css');
          await import('/src/components/agents/agent-manager.css');
          const { useThemeStore } = await import('/src/stores/themeStore.ts');
          const store = useThemeStore.getState();
          store.setAppTheme({ ...store.appTheme, appearance: 'manual', isDark: window.fixture.appearance === 'dark' });
          const { AgentSignIn } = await import('/src/components/agents/AgentSignIn.tsx');
          const root = ReactDOM.createRoot(document.getElementById('root'));
          const opener = document.getElementById('opener');
          opener.onclick = () => root.render(React.createElement(AgentSignIn, { agentId: 'claude', agentName: 'Claude Code', profileId: 'fixture', profileName: 'Browser fixture', returnFocus: opener, onStatus: () => {}, onClose: () => root.render(null) }));
          window.fixture.ready = true;
        </script></body></html>`,
        }),
      );
      await page.goto(`${origin}/signin-fixture.html`);
      await page.waitForFunction(() => window.fixture.ready);
      await page.getByRole('button', { name: 'Open sign-in fixture' }).click();
      await page
        .getByRole('textbox', { name: 'Claude Code sign-in input' })
        .waitFor({ state: 'attached' });
      // OSC 8 is split across polls, just as PTY reads can split long authorization URLs.
      await page.evaluate(() =>
        window.fixture.chunks.push({
          sequence: 1,
          data: `\x1b]8;;${window.fixtureUrl.slice(0, 80)}`,
        }),
      );
      await page.waitForTimeout(550);
      assert.deepEqual(await page.evaluate(() => window.fixture.opened), []);
      await page.evaluate(() =>
        window.fixture.chunks.push({
          sequence: 2,
          data: `${window.fixtureUrl.slice(80)}\x1b\\Open Claude sign-in\x1b]8;;\x1b\\\r\n`,
        }),
      );
      const link = page.getByRole('textbox', { name: 'Sign-in link', exact: true });
      await link.waitFor();
      assert.equal(await link.inputValue(), url);
      await page
        .getByText('Could not open the browser. Copy the link or select it below.')
        .waitFor();
      assert.deepEqual(await page.evaluate(() => window.fixture.opened), [url]);
      await page.getByRole('button', { name: 'Copy link', exact: true }).click();
      assert.equal(await page.evaluate(() => window.fixture.copied), url);
      await page.evaluate(() => {
        window.fixture.failCopy = true;
      });
      await page.getByRole('button', { name: 'Copy link', exact: true }).click();
      await page
        .getByText('Could not copy the link. Select it above and copy it manually.')
        .waitFor();
      await link.focus();
      assert.equal(
        await link.evaluate((input) => input.selectionEnd - input.selectionStart),
        url.length,
      );
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Open browser');
      await page.evaluate(() => {
        window.fixture.failOpen = false;
      });
      await page.keyboard.press('Enter');
      await page.getByText('Opened in your browser.').waitFor();
      assert.deepEqual(await page.evaluate(() => window.fixture.opened), [url, url]);
      // Plain ANSI-colored text wrapping to several terminal rows must retain the entire URL.
      await page.evaluate(() =>
        window.fixture.chunks.push({
          sequence: 3,
          data: `\x1b[32m${window.fixtureUrl}\x1b[0m\r\nPaste the authorization code: `,
        }),
      );
      await page.waitForTimeout(600);
      assert.equal(await page.getByRole('button', { name: 'Copy link', exact: true }).count(), 1);
      assert.deepEqual(await page.evaluate(() => window.fixture.opened), [url, url]);
      const terminal = page.getByRole('textbox', { name: 'Claude Code sign-in input' });
      await terminal.focus();
      await page.keyboard.type('fixture-code');
      await page.waitForFunction(() => window.fixture.inputs.join('') === 'fixture-code');
      assert.equal((await page.evaluate(() => window.fixture.inputs)).join(''), 'fixture-code');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Copy link');
      await page.screenshot({ path: `${output}/${appearance}-${width}.png` });
      const bounds = await page.getByRole('dialog').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      await page.getByRole('button', { name: 'Cancel sign-in' }).click();
      await page.waitForFunction(() => document.activeElement.id === 'opener');
      assert.ok((await page.evaluate(() => window.fixture.stopped)).length > 0);
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    'Sign-in browser fixtures passed: OSC 8, split/wrapped URLs, browser/copy recovery, keyboard, cancellation, focus return, four layouts. No native sign-in was performed.',
  );
} finally {
  await browser.close();
}
