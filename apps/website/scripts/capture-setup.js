async function _captureSetup(page) {
  await page.addInitScript(() => {
    const save = (key, state, version = 0) => {
      localStorage.setItem(key, JSON.stringify({ state, version }));
    };
    save('jackalope-onboarding-v1', { status: 'skipped', step: 'project' });
    save(
      'jackalope-projects',
      {
        projects: [
          {
            id: 'alpha',
            name: 'Atlas',
            path: 'C:/Fixture/Atlas',
            gitBranch: 'main',
            worktrees: [],
            agentProvider: 'codex',
          },
          {
            id: 'beta',
            name: 'Beacon',
            path: 'C:/Fixture/Beacon',
            gitBranch: 'main',
            worktrees: [],
            agentProvider: 'claude-code',
          },
        ],
        activeProjectId: 'alpha',
      },
      1,
    );
    save(
      'jackalope-tasks',
      {
        tasks: [
          {
            id: 'idea-alpha',
            projectId: 'alpha',
            title: 'Improve keyboard navigation',
            rawPrompt: 'Make all controls keyboard accessible.',
            status: 'backlog',
            assignedAgent: 'codex',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
      1,
    );
    save(
      'jackalope-schedules',
      {
        schedules: [
          {
            id: 'plan-beta',
            name: 'Beacon weekly checks',
            description: '',
            cronExpression: '0 9 * * 1-5',
            targetProjectId: 'beta',
            assignedAgentProvider: 'claude',
            prompt: 'Review the test coverage.',
            enabled: true,
            nextRun: '',
          },
        ],
      },
      2,
    );
    save('jackalope-execution-ui-v1', {
      drafts: { alpha: { prompt: '', agent: 'codex', isolated: true } },
      selectedId: null,
    });
    window.__auditCalls = [];
    window.__auditErrors = {};
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    const base = {
      taskId: 'task-one',
      projectId: 'alpha',
      projectName: 'Atlas',
      projectPath: 'C:/Fixture/Atlas',
      workspace: 'C:/Fixture/Atlas/.worktrees/check',
      branch: 'task/check',
      baseHead: 'a'.repeat(40),
      agent: 'codex',
      account: 'Signed in',
      model: 'Configured model',
      prompt: 'Improve the search experience',
      status: 'review',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      sessionId: 'session-one',
      result:
        'The search flow is ready for review.\n\n- Keyboard access added\n- Empty results now explain the next action',
      activity: ['Read project instructions', 'Checked updated controls'],
      diagnostics: [],
      error: null,
      persistenceError: null,
      exitCode: 0,
      usage: {
        input: 1200,
        output: 340,
        cacheRead: 200,
        cacheWrite: 0,
        reported: true,
        estimatedCostUsd: null,
      },
      prompts: [],
      screenshots: [],
      validationSteps: [],
    };
    window.__auditRuns = [
      {
        ...base,
        id: 'run-review',
        screenshots: [
          {
            id: 'image-one',
            name: 'Search results',
            filePath: 'C:/Fixture/Atlas/.jackalope/artifacts/screenshots/results.png',
            url: 'http://localhost:3000',
            width: 1280,
            height: 800,
            timestamp: new Date().toISOString(),
          },
        ],
        validationSteps: [
          {
            id: 'check-one',
            step: 'Keyboard navigation through search results',
            status: 'passed',
            notes: 'Tab and Enter reach every result.',
            evidence: [],
            timestamp: new Date().toISOString(),
          },
        ],
      },
      {
        ...base,
        id: 'run-working',
        taskId: 'task-two',
        prompt: 'Check the profile settings',
        status: 'running',
        endedAt: null,
        result: '',
        exitCode: null,
        prompts: [
          {
            id: 'question-one',
            runId: 'run-working',
            question: 'Which setting should be the default?',
            inputType: 'text',
            options: [],
            status: 'pending',
            createdAt: new Date().toISOString(),
          },
        ],
      },
      {
        ...base,
        id: 'run-failed',
        taskId: 'task-three',
        prompt: 'Investigate a startup failure',
        status: 'failed',
        error: 'The agent could not complete this attempt.',
        result: '',
        sessionId: null,
      },
      {
        ...base,
        id: 'run-interrupted',
        taskId: 'task-four',
        prompt: 'Finish the import workflow',
        status: 'reviewed',
        error: 'The application closed before this attempt finished.',
        sessionId: null,
      },
    ];
    window.__auditRuns = window.__auditRuns.filter((run) => run.status !== 'failed');
    window.__auditRuns.find((run) => run.id === 'run-working').prompts = [];
    window.__auditRuns.find((run) => run.id === 'run-working').agent = 'claude';
    window.__auditRuns.find((run) => run.id === 'run-working').prompt =
      'Polish the settings experience';
    window.__auditRuns.find((run) => run.id === 'run-interrupted').error = null;
    window.__auditRuns.find((run) => run.id === 'run-review').screenshots = [];
    window.__auditRuns.find((run) => run.id === 'run-review').verifyCommand = 'pnpm check';
    window.__auditRuns.find((run) => run.id === 'run-review').verification = {
      command: 'pnpm check',
      checkedAt: new Date().toISOString(),
      tree: 'b'.repeat(40),
      result: {
        exitCode: 0,
        success: true,
        timedOut: false,
        stdout: 'Typecheck and keyboard navigation checks passed.',
        stderr: '',
        truncated: false,
        durationMs: 2400,
      },
    };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1,
      invoke: async (command, args) => {
        window.__auditCalls.push({ command, args });
        if (window.__auditErrors[command]) throw new Error(window.__auditErrors[command]);
        if (command === 'release_status') return { version: '0.1.0', activeTasks: 0 };
        if (command === 'task_start') {
          const request = args.request;
          window.__auditRuns.unshift({
            ...base,
            ...request,
            id: request.id,
            taskId: request.id,
            status: 'running',
            result: '',
            prompts: [],
            startedAt: new Date().toISOString(),
          });
          return request.id;
        }
        if (command === 'task_runs') return window.__auditRuns;
        if (command === 'task_runners')
          return ['codex', 'claude', 'grok'].map((id) => ({
            id,
            name: id === 'claude' ? 'Claude Code' : id === 'codex' ? 'Codex' : 'Grok',
            available: id !== 'grok',
            signedIn: id !== 'grok',
            account: id !== 'grok' ? 'Signed in' : '',
            detail: id === 'grok' ? 'Executable not found' : 'Ready to use',
          }));
        if (command === 'task_history_recovery')
          return { directory: 'C:/Fixture/history', entries: [] };
        if (command === 'desktop_settings') return { closeToTray: true };
        if (command === 'system_get_info')
          return {
            os: 'Windows',
            arch: 'x86_64',
            device_name: 'Development PC',
            git_available: true,
          };
        if (command === 'git_list_worktrees')
          return [
            {
              path: args.repoPath,
              head: 'a'.repeat(40),
              branch: 'main',
              is_bare: false,
              is_locked: false,
            },
            {
              path: `${args.repoPath}/.worktrees/search`,
              head: 'b'.repeat(40),
              branch: 'task/search',
              is_bare: false,
              is_locked: false,
            },
          ];
        if (command === 'mcp_list_servers')
          return [
            {
              id: 'docs',
              name: 'Documentation',
              scope: 'codex',
              transport: 'http',
              url: 'https://example.com/mcp',
              command: '',
              args: [],
              env: {},
              description: 'Look up project documentation.',
            },
          ];
        if (command === 'queue_snapshot')
          return {
            items: [
              {
                id: 'queue-one',
                projectId: 'alpha',
                title: 'Improve search',
                prompt: base.prompt,
                agent: 'codex',
                scopes: ['src/search'],
                dependencies: [],
                runId: 'run-review',
                error: null,
                canceled: false,
              },
            ],
            messages: [],
            enabledProjects: [],
            concurrency: 3,
            bridgeUrl: null,
            bridgeError: null,
            mergedRunIds: [],
          };
        if (command === 'integration_plans') return [];
        if (command === 'task_review')
          return {
            files: ['src/search.tsx'],
            diff: 'diff --git a/src/search.tsx b/src/search.tsx\n--- a/src/search.tsx\n+++ b/src/search.tsx\n@@ -12,3 +12,4 @@\n <SearchResults\n+  onKeyDown={handleResultNavigation}\n   results={results}\n />',
            note: 'Current workspace compared with starting commit.',
          };
        if (command === 'task_screenshot')
          return Array.from(
            Uint8Array.from(
              atob(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6lcAAAAASUVORK5CYII=',
              ),
              (c) => c.charCodeAt(0),
            ),
          );
        if (command === 'task_respond_prompt') {
          const prompt = window.__auditRuns
            .find((run) => run.id === args.runId)
            ?.prompts?.find((prompt) => prompt.id === args.promptId);
          if (!prompt) return false;
          prompt.status = 'answered';
          prompt.answer = args.answer;
          return true;
        }
        if (command === 'agent_save_policy' || command.startsWith('plugin:')) return false;
        throw new Error(`Unsupported audit fixture command: ${command}`);
      },
    };
  });
  await page.setViewportSize({ width: 1440, height: 840 });
  await page.reload();
  await page.addStyleTag({
    content: '*,*::before,*::after {transition:none !important;animation:none !important;}',
  });
}
