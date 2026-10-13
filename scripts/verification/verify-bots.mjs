import assert from 'node:assert/strict';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5192';
const output = 'output/playwright/bots';
await mkdir(output, { recursive: true });
const fixture = `
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BotsWorkspace } from '/src/components/bots/BotsWorkspace.tsx';
import { useBotStore } from '/src/stores/botStore.ts';
import { useBotHubStore } from '/src/lib/bot-hub.ts';
import { useProjectStore } from '/src/stores/projectStore.ts';
import { useThemeStore } from '/src/stores/themeStore.ts';
import '/src/index.css';
import '/src/components/tasks/task-workspace.css';
import '/src/components/ui/experience.css';
const bot = '6f1f9a52-3c1e-4c6b-9a55-2c36c0b6a001';
const at = (hours) => new Date(Date.now() - hours * 3600000).toISOString();
const persona = { botId: bot, name: 'Scout', instructions: 'Keep dependencies healthy.' };
const request = { id: 'r', projectId: 'work', projectName: 'Work', projectPath: '/fixture/work', agent: 'codex', prompt: 'Bot', isolated: true };
const message = (id, text, runId, extra = {}) => ({ id, text, createdAt: at(3), runId, canceled: false, ...extra });
const batch = (runId) => ({ runId, messageIds: [], previousRunId: null, error: null, settled: true });
const session = (id, title, hours, extra = {}) => ({ id, title, persona, request, createdAt: at(hours + 1), updatedAt: at(hours), paused: false, closed: false, pinned: false, messages: [], batches: [], draft: { text: '', revision: 0 }, error: null, ...extra });
const run = (id, session, result, hours) => ({ id, taskId: id, liveSessionId: session, projectId: 'work', projectName: 'Work', agent: 'codex', status: 'review', startedAt: at(hours + 1), endedAt: at(hours), result, prompt: 'Bot', prompts: [], workspace: '', logs: [], usage: {} });
const latest = session('latest', 'Fix the flaky lockfile check', 1, {
  messages: [message('m1', 'Why does the lockfile check fail?', 'run-latest')],
  batches: [batch('run-latest')],
});
const limited = session('limited', 'Nightly dependency sweep', 30, {
  paused: true,
  limits: { maxBatches: 2, pauseAtEstimatedUsd: null },
  error: 'The session reached its batch limit. Review the result and adjust limits before resuming.',
  messages: [message('m2', 'Nightly sweep', 'run-a', { origin: { kind: 'wake', label: 'Nightly sweep' } }), message('m3', 'Continue', 'run-b', { origin: { kind: 'wake', label: 'Nightly sweep' } })],
  batches: [batch('run-a'), batch('run-b')],
});
const older = Array.from({ length: 12 }, (_, index) => session('older-' + index, 'Earlier review ' + (index + 1), 48 + index));
const f = window.botFixture = { calls: [],
  theme: (dark) => useThemeStore.getState().setAppTheme({ ...useThemeStore.getState().appTheme, isDark: dark, appearance: 'manual' }),
  snapshot: { sessions: [latest, limited, ...older], runs: [run('run-latest', 'latest', '## Found it\\nThe lockfile check fails because the cache key ignores the pnpm version.', 0.5), run('run-a', 'limited', 'Updated two packages.', 31), run('run-b', 'limited', 'Nothing else needs updating.', 30)], error: null },
  hub: { cards: [], proposals: [], events: [], wakes: [], relays: [], paused: false, error: null,
    notes: [{ id: 'note-1', botId: bot, text: 'The user prefers one pull request per dependency.', sessionId: 'latest', updatedAt: at(2) }] },
};
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 0, unregisterCallback: () => {}, invoke: async (command, args = {}) => {
  f.calls.push({ command, ...args });
  switch (command) {
    case 'live_session_snapshot': return f.snapshot;
    case 'bot_hub_snapshot': return f.hub;
    case 'bot_hub_forget_note': f.hub = { ...f.hub, notes: f.hub.notes.filter((note) => note.id !== args.id) }; return null;
    case 'live_session_send': return { text: '', revision: 1 };
    case 'live_session_limits': return null;
    case 'live_session_action': return null;
    case 'plugin:event|listen': return 0;
    default: return null;
  }
}};
useProjectStore.setState({ activeProjectId: 'work', projects: [{ id: 'work', name: 'Work', path: '/fixture/work', gitBranch: 'main', worktrees: [], agentProvider: 'codex', preferences: {} }] });
useBotStore.setState({ bots: [{ id: bot, name: 'Scout', role: 'Keeps dependencies healthy', instructions: 'Keep dependencies healthy.', agent: 'codex', model: null, projectId: 'work', connectionIds: null, routineIds: [], wakes: [], collaborate: true, pinned: false, createdAt: at(100), updatedAt: at(100), appearance: { style: 'cat', color: 'teal' } }], selectedId: bot, seen: { limited: at(0) }, seenFloor: at(1000), openSessionId: null });
void useBotHubStore.getState().refresh();
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement('main', { style: { height: '100vh', overflow: 'auto' } }, React.createElement(BotsWorkspace)));
`;
const fixturePath = `apps/desktop/scratch/bots-${process.pid}.tsx`;
await mkdir('apps/desktop/scratch', { recursive: true });
await writeFile(fixturePath, fixture);
const browser = await chromium.launch({
  channel: process.env.UI_BROWSER_CHANNEL ?? 'chrome',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/src/main.tsx*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `import "/scratch/bots-${process.pid}.tsx";`,
    }),
  );
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const calls = (command) =>
    page.evaluate(
      (command) => window.botFixture.calls.filter((c) => c.command === command),
      command,
    );

  // The roster names real activity: an unread reply, not a decorative status.
  await page.getByRole('button', { name: 'Scout, 1 new reply', exact: true }).waitFor();
  const composer = page.getByRole('textbox', { name: 'Message Scout', exact: true });
  await composer.waitFor();
  const thread = page.locator('.bots-composer-thread');
  assert.match(await thread.innerText(), /Continues Fix the flaky lockfile check/);
  assert.match(await page.locator('.bots-conversation-preview').first().innerText(), /^Found it$/);

  // Long lists stay short until asked, and search finds older conversations.
  assert.equal(await page.locator('.bots-conversation-row').count(), 12);
  await page.getByRole('searchbox', { name: 'Search conversations' }).fill('review 12');
  assert.equal(await page.locator('.bots-conversation-row').count(), 1);
  await page.getByRole('searchbox', { name: 'Search conversations' }).fill('');
  await page.getByRole('button', { name: 'Show all 14' }).click();
  assert.equal(await page.locator('.bots-conversation-row').count(), 14);

  for (const width of [1280, 640]) {
    await page.setViewportSize({ width, height: 840 });
    for (const dark of [false, true]) {
      await page.emulateMedia({ reducedMotion: dark ? 'reduce' : 'no-preference' });
      await page.evaluate((dark) => window.botFixture.theme(dark), dark);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `${output}/profile-${width}-${dark ? 'dark' : 'light'}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 840 });

  // New conversation is a keyboard-reachable choice that can be undone.
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  assert.equal(await thread.innerText(), 'Starts a new conversation');
  await page.getByRole('button', { name: 'Continue latest', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.match(await thread.innerText(), /Continues/);

  // Sending continues the latest conversation instead of creating another.
  await composer.fill('Also check the CI cache.');
  await composer.press('Enter');
  await page.waitForFunction(() =>
    window.botFixture.calls.some((c) => c.command === 'live_session_send'),
  );
  const [sent] = await calls('live_session_send');
  assert.equal(sent.id, 'latest');
  assert.equal(sent.text, 'Also check the CI cache.');
  assert.equal((await calls('live_session_create')).length, 0);
  await page.getByRole('button', { name: 'Back to work' }).click();

  // The person can remove a note the bot saved.
  await page.getByRole('button', { name: /^Remove note: The user prefers/ }).click();
  await page.waitForFunction(() =>
    window.botFixture.calls.some((c) => c.command === 'bot_hub_forget_note'),
  );
  await page.getByText(/Nothing saved yet/).waitFor();

  // A conversation paused at its batch limit explains why and can continue.
  await page.getByRole('button', { name: /Nightly dependency sweep/ }).click();
  await page.getByText(/paused after 2 replies it started without you/).waitFor();
  await page.screenshot({ path: `${output}/batch-limit.png` });
  await page.getByRole('button', { name: 'Let it continue', exact: true }).click();
  await page.waitForFunction(() =>
    window.botFixture.calls.some((c) => c.command === 'live_session_action'),
  );
  const [limits] = await calls('live_session_limits');
  assert.equal(limits.id, 'limited');
  assert.equal(limits.limits.maxBatches, 22);
  const [resume] = await calls('live_session_action');
  assert.equal(resume.action, 'resume');
  assert.deepEqual(errors, []);
  console.log(
    'Bots fixtures passed: unread roster, continuing conversations, search, memory, batch limits, themes and narrow layout.',
  );
} finally {
  await browser.close();
  await unlink(fixturePath);
}
