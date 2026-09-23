import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const fixture = new URL('../scratch/mcp-marketplace/', import.meta.url);
await mkdir(fixture, { recursive: true });
await mkdir('output/playwright', { recursive: true });
await writeFile(
  new URL('fixture.html', fixture),
  `<!doctype html><html><body><div id="root" style="height:100vh;display:flex"></div><script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import { McpWorkspace } from '/src/components/mcp/McpWorkspace.tsx';
import { useProjectStore } from '/src/stores/projectStore.ts';
import { useThemeStore } from '/src/stores/themeStore.ts';
import { useSettingsStore } from '/src/stores/settingsStore.ts';
import '/src/index.css';
import '/src/components/tasks/task-workspace.css';
import '/src/components/ui/experience.css';
useProjectStore.setState({projects:[{id:'fixture',name:'Sample project',path:'C:/fixture',agentProvider:'codex'}],activeProjectId:'fixture'});
useSettingsStore.setState({useMcpMarketplace:true});
window.storeModule = name => import('/src/stores/'+name+'.ts');
const theme = useThemeStore.getState();
theme.setTheme({...theme.currentTheme,appearance:'manual',isDark:false});
createRoot(document.getElementById('root')).render(React.createElement(McpWorkspace));
</script></body></html>`,
);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  const directoryRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://github.com/**', (route) => route.abort());
  await page.route('https://allmcps.com/**', (route) => {
    directoryRequests.push(route.request().url());
    return route.fulfill({ status: 503, body: 'Unavailable' });
  });
  await page.addInitScript(() => {
    window.pagesFixture = { calls: [], configurations: [], probeFailure: false, clipboard: '' };
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (value) => {
          window.pagesFixture.clipboard = value;
        },
      },
    });
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 0,
      invoke: async (command, args) => {
        const f = window.pagesFixture;
        f.calls.push(command);
        if (command === 'mcp_list_servers') return structuredClone(f.configurations);
        if (command === 'mcp_save_server') {
          f.mcpSaved = args.server;
          f.configurations = f.configurations.filter(
            (s) => s.id !== args.server.id || s.scope !== args.server.scope,
          );
          f.configurations.push(args.server);
          return;
        }
        if (command === 'mcp_probe_server')
          return f.probeFailure
            ? { ok: false, tools: [], error: '401 token=fixture-private-secret' }
            : { ok: true, tools: [{ name: 'read_item' }], latencyMs: 25 };
        return null;
      },
    };
  });
  await page.goto(
    `${process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5197'}/scratch/mcp-marketplace/fixture.html`,
  );
  await page.getByRole('button', { name: 'Add tools', exact: true }).click();
  await page.getByRole('heading', { name: 'MCP marketplace', exact: true }).waitFor();
  assert.equal(await page.locator('.mcp-market-card').count(), 10);
  for (const width of [1280, 960]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const isDark of [false, true]) {
      await page.evaluate(async (isDark) => {
        const { useThemeStore } = await window.storeModule('themeStore');
        useThemeStore
          .getState()
          .setTheme({ ...useThemeStore.getState().currentTheme, appearance: 'manual', isDark });
      }, isDark);
      await page.waitForTimeout(250);
      await page.screenshot({
        path: `output/playwright/mcp-recommended-${isDark ? 'dark' : 'light'}-${width}.png`,
      });
      assert.ok(
        await page
          .locator('.mcp-workspace')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      );
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const github = page.getByRole('article', { name: 'GitHub', exact: true });
  const githubDetails = github.getByRole('button', { name: 'View details' });
  await githubDetails.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'GitHub', exact: true }).waitFor();
  assert.ok(await page.getByRole('link', { name: 'Publisher setup guide' }).getAttribute('href'));
  await page.getByRole('button', { name: 'Configure server', exact: true }).click();
  assert.equal(
    await page.getByLabel('Endpoint URL').inputValue(),
    'https://api.githubcopilot.com/mcp/',
  );
  assert.equal(
    await page.getByLabel('Bearer token', { exact: true }).getAttribute('type'),
    'password',
  );
  await page.getByLabel('Bearer token', { exact: true }).fill('fixture-only-token');
  const tokenBounds = await page.getByLabel('Bearer token', { exact: true }).boundingBox();
  const footerBounds = await page.locator('.mcp-configure-actions').boundingBox();
  assert.ok(
    tokenBounds.y + tokenBounds.height <= footerBounds.y,
    'Actions must not obscure the token field',
  );
  await page.screenshot({ path: 'output/playwright/mcp-token-setup.png' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Back to marketplace', exact: true }).click();
  assert.equal(await githubDetails.evaluate((element) => element === document.activeElement), true);
  await page
    .getByRole('article', { name: 'Linear', exact: true })
    .getByRole('button', { name: 'Configure', exact: true })
    .click();
  assert.equal(await page.getByLabel('Authentication').inputValue(), 'oauth');
  assert.equal(await page.getByRole('switch', { name: 'On-demand tools' }).isChecked(), false);
  assert.equal(await page.getByRole('switch', { name: 'On-demand tools' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await page.getByRole('heading', { name: 'Connection saved. Finish signing in.' }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Sign in with Codex', exact: true }).count(),
    1,
  );
  assert.equal(
    await page.evaluate(() => window.pagesFixture.calls.includes('mcp_probe_server')),
    false,
  );
  assert.equal(
    await page.evaluate(() => window.pagesFixture.calls.includes('mcp_authenticate')),
    false,
  );
  await page.screenshot({ path: 'output/playwright/mcp-agent-sign-in.png' });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('heading', { name: 'MCP connections', exact: true }).waitFor();
  await page.evaluate(() => {
    window.pagesFixture.calls = [];
  });
  await page.getByRole('button', { name: 'Add tools', exact: true }).click();

  assert.equal(directoryRequests.length, 0, 'Recommended browsing must not fetch the directory');
  await page.getByRole('searchbox', { name: 'Search MCP marketplace' }).fill('github');
  await page.getByText(/The directory could not be loaded/).waitFor();
  assert.equal(await page.getByRole('article', { name: 'GitHub', exact: true }).count(), 1);
  await page.getByRole('searchbox', { name: 'Search MCP marketplace' }).fill('');
  await page.getByRole('button', { name: 'Custom connection', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Sample tools');
  await dialog.getByLabel('Endpoint URL').fill('https://example.com/mcp');
  await dialog.getByLabel('Authentication').selectOption('token');
  await dialog.getByLabel('Bearer token', { exact: true }).fill('fixture-token');
  await dialog.getByRole('button', { name: 'All projects', exact: true }).click();
  await dialog.locator('summary').click();
  await dialog.getByLabel('Headers and client options (JSON)').fill('not json');
  await page.screenshot({ path: 'output/playwright/mcp-modal-debug.png' });
  await dialog.getByRole('button', { name: 'Save and check', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  await dialog
    .getByLabel('Headers and client options (JSON)')
    .fill('{"headers":{"X-Tenant":"sample"},"enabled_tools":["read_item"]}');
  await page.evaluate(() => {
    window.pagesFixture.probeFailure = true;
  });
  await dialog.getByRole('button', { name: 'Save and check', exact: true }).click();
  await dialog.getByRole('heading', { name: 'Connection saved', exact: true }).waitFor();
  await dialog.getByText(/Sign-in or credentials needed/).waitFor();
  assert.ok(!(await dialog.innerText()).includes('fixture-private-secret'));
  await page.screenshot({ path: 'output/playwright/mcp-saved-failure.png' });
  await dialog.getByRole('button', { name: 'Edit settings', exact: true }).click();
  assert.equal(
    await dialog.getByLabel('Bearer token', { exact: true }).inputValue(),
    'fixture-token',
  );
  assert.ok(
    !(await dialog.getByLabel('Headers and client options (JSON)').inputValue()).includes(
      'fixture-token',
    ),
  );
  await page.evaluate(() => {
    window.pagesFixture.probeFailure = false;
  });
  await dialog.getByRole('button', { name: 'Save and check', exact: true }).click();
  await dialog.getByRole('heading', { name: 'Connection checked', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.pagesFixture.mcpSaved.extra), {
    headers: { 'X-Tenant': 'sample', Authorization: 'Bearer fixture-token' },
    enabled_tools: ['read_item'],
  });
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page
    .getByRole('button', { name: /Connections/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Copy Sample tools redacted configuration' }).click();
  const copied = await page.evaluate(() => window.pagesFixture.clipboard);
  assert.ok(!copied.includes('fixture-token'));
  assert.ok(!copied.includes('Bearer'));
  await page.getByRole('button', { name: 'Custom connection', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Sample tools');
  await dialog.getByLabel('Endpoint URL').fill('https://example.com/mcp');
  await dialog.getByRole('button', { name: 'All projects', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save and check', exact: true }).click();
  await dialog.getByText(/already exists here/).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Add tools', exact: true }).click();
  await page.evaluate(async () => {
    const { useSettingsStore } = await window.storeModule('settingsStore');
    useSettingsStore.getState().setUseMcpMarketplace(false);
  });
  await page.getByText('MCP Marketplace is currently disabled', { exact: true }).waitFor();
  assert.equal(await page.locator('.mcp-market-card').count(), 0);
  const before = directoryRequests.length;
  await page.getByRole('button', { name: 'Enable Marketplace', exact: true }).click();
  assert.equal(await page.locator('.mcp-market-card').count(), 10);
  assert.equal(directoryRequests.length, before);
  assert.deepEqual(errors, []);
  console.log(
    'MCP marketplace browser fixtures passed: discovery, auth setup, save/check recovery, redaction, duplicates, opt-out, themes, focus and narrow layouts.',
  );
} finally {
  await browser.close();
}
