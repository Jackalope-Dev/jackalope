import { readFileSync } from 'node:fs';

const setup = new Function(
  `${readFileSync(new URL('./capture-setup.js', import.meta.url), 'utf8')}; return _captureSetup;`,
)();

export async function setupWorkspaceCapture(page, dark) {
  await setup(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      'jackalope-schedules',
      JSON.stringify({ state: { schedules: [] }, version: 3 }),
    );
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'task_start' || command === 'schedule_save') {
        throw new Error('Workspace captures must not launch or schedule tasks.');
      }
      if (command === 'app_community_settings') {
        return {
          reviewed: true,
          telemetry: false,
          errors: false,
          configured: false,
          buildChannel: 'beta',
        };
      }
      if (command === 'task_changes') {
        return {
          revision: 1,
          runs: window.__auditRuns,
          ids: window.__auditRuns.map((run) => run.id),
        };
      }
      if (command === 'app_release_status')
        return {
          currentVersion: '0.1.0',
          channel: 'beta',
          betaAvailable: false,
          configured: false,
          availableVersion: null,
          notes: null,
        };
      if (command === 'notification_status' || command === 'notification_configure')
        return { supported: true, enabled: true, error: null };
      if (command === 'agent_models')
        return {
          models: [{ id: 'gpt-5', name: 'GPT-5', isDefault: true }],
          source: 'Sample catalog',
          account: null,
          checkedAt: new Date().toISOString(),
          detail: 'Fictional capture data',
        };
      if (command === 'task_review')
        return {
          files: ['src/search.tsx'],
          diff: 'diff --git a/src/search.tsx b/src/search.tsx\n--- a/src/search.tsx\n+++ b/src/search.tsx\n@@ -1,4 +1,6 @@\n export function Search() {\n   return <SearchResults\n+    onKeyDown={handleResultNavigation}\n+    onClose={returnFocus}\n     results={results} />;\n }\n',
          note: 'Current workspace compared with starting commit.',
        };
      if (command === 'capacity_snapshot') return [];
      if (command === 'agent_profile_list') {
        return {
          profiles: [{ id: 'sample-work', name: 'Atlas work', group: 'work' }],
          activeId: null,
          defaultGroup: 'personal',
          defaultName: 'Personal',
          envVar: 'CODEX_HOME',
        };
      }
      if (command === 'agent_profile_status') {
        return {
          state: 'signedIn',
          identity: args.id ? 'atlas@example.com' : 'personal@example.com',
          detail: 'Sample account',
          checkedAt: new Date().toISOString(),
        };
      }
      if (command === 'knowledge_list') {
        return [
          {
            id: 'sample-lesson',
            kind: 'memory',
            title: 'Keep keyboard focus predictable',
            content:
              'Return focus to the control that opened a dialog.\nKeep arrow-key navigation within the results list.\nTest Escape, Tab, and an empty search before review.',
            keywords: ['search', 'keyboard', 'dialogs'],
          },
          {
            id: 'sample-workflow',
            kind: 'workflow',
            title: 'Review a UI change',
            content:
              'Read the brief and inspect the patch.\nCheck light and dark appearances.\nWalk through keyboard navigation and a narrow window.\nRecord the checks with the result.',
            keywords: ['UI', 'review'],
          },
        ].map((entry) => ({
          ...entry,
          projectId: 'alpha',
          projectPath: 'C:/Fixture/Atlas',
          enabled: true,
          sourceRunId: null,
          revision: 1,
          updatedAt: '2026-09-10T12:00:00Z',
        }));
      }
      if (command === 'schedule_list') {
        return {
          error: null,
          schedules: [
            {
              name: 'Weekly dependency review',
              expression: '0 9 * * 1',
              prompt:
                'Review outdated dependencies and recommend checks. Keep version changes a separate decision.',
              monitor: null,
            },
            {
              name: 'Watch API documentation',
              expression: '0 */6 * * *',
              prompt: 'Review documentation when the API changes.',
              monitor: { path: 'src/api', action: 'notify' },
            },
          ].map((item, index) => ({
            definition: {
              id: `sample-schedule-${index}`,
              ...item,
              enabled: false,
              timezone: 'America/Denver',
              missed: 'skip',
              request: {
                id: `sample-task-${index}`,
                projectId: 'alpha',
                projectName: 'Atlas',
                projectPath: 'C:/Fixture/Atlas',
                agent: 'codex',
                prompt: item.prompt,
                isolated: true,
                targetBranch: 'main',
              },
            },
            nextAt: '2026-09-14T15:00:00Z',
            history: [],
          })),
        };
      }
      return invoke(command, args);
    };
  });
  await page.reload();
  await page.getByRole('button', { name: 'Tasks', exact: true }).waitFor();
  await page.waitForTimeout(6500);
  await page.evaluate(async (isDark) => {
    const { useThemeStore } = await import('/src/stores/themeStore.ts');
    const { useCompanionStore } = await import('/src/stores/companionStore.ts');
    const { useContextMemoryStore } = await import('/src/stores/contextMemoryStore.ts');
    useThemeStore.getState().setTheme({ ...useThemeStore.getState().currentTheme, isDark });
    useCompanionStore.setState({ sources: {} });
    useContextMemoryStore.setState({
      memories: {
        alpha: {
          projectId: 'alpha',
          projectName: 'Atlas',
          projectPath: 'C:/Fixture/Atlas',
          summary: 'A shared place to find and organize project knowledge.',
          techStack: ['React', 'TypeScript', 'Vite'],
          conventions: [
            'Use shared controls and theme tokens.',
            'Keep keyboard focus visible.',
            'Review the patch and its checks before merging.',
          ],
          openTasks: [],
          roadmapItems: [],
          buildCommands: ['pnpm build'],
          testCommands: ['pnpm test'],
          lastScannedAt: '2026-09-10T12:00:00Z',
          tokenUsageEstimate: 0,
          scanDurationMs: 0,
          sourceFilesDetected: ['AGENTS.md', 'package.json', 'README.md'],
        },
      },
    });
  }, dark);
  await page.evaluate(() => document.fonts.ready);
}
