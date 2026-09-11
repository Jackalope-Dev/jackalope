import { applyThemeTokens, type ThemePalette } from '@jackalope/brand/theme';
import { useEffect, useState } from 'react';
import {
  helperPreferencePatch,
  helperTheme,
  sameHelperValue,
  type ThemeChange,
} from '../../lib/helper-actions';
import { nativeTask } from '../../lib/task-runtime';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import {
  type HelperAction as Action,
  helperPreferences,
  useHelperStore,
} from '../../stores/helperStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import type { ActiveTab } from '../layout/navigation';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

const destinations: Record<string, ActiveTab> = {
  tasks: 'kanban',
  agents: 'agents',
  'agent-settings': 'agent-settings',
  mcp: 'mcps',
  usage: 'usage',
  settings: 'preferences',
  schedules: 'schedules',
  project: 'topology',
  worktrees: 'worktrees',
  knowledge: 'project-knowledge',
};
const labels: Record<string, string> = {
  open_task: 'Open task',
  stop_task: 'Stop task',
  set_default_agent: 'Default agent',
  set_theme: 'Appearance',
  set_preferences: 'Preferences',
  navigate: 'Open a page',
  prepare_task: 'Prepare a task',
};

export function HelperAction({ action, onNavigate }: { action: Action; onNavigate: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ThemePalette>();
  const [undo, setUndo] = useState<() => void>();
  const { input, expected } = action.arguments;
  const projectName = useProjectStore(
    (state) => state.projects.find((project) => project.id === input.project_id)?.name,
  );
  const expired = action.status === 'proposed' && Date.now() - action.createdAt >= 600_000;
  useEffect(() => {
    if (!preview) return;
    useThemeStore.setState({ previewing: true });
    applyThemeTokens(preview);
    return () => {
      useThemeStore.setState({ previewing: false });
      applyThemeTokens(useThemeStore.getState().currentTheme);
    };
  }, [preview]);
  const checkTheme = () => {
    const project = useProjectStore.getState();
    const state = useThemeStore.getState();
    if (state.previewing && !preview)
      throw new Error('Finish the current appearance preview first.');
    const scope = input.scope;
    if (scope !== 'app' && scope !== 'project') throw new Error('Invalid theme scope.');
    if (
      scope === 'project' &&
      (project.activeProjectId !== expected.projectId ||
        !project.projects.some((p) => p.id === expected.projectId))
    )
      throw new Error('The selected project changed. Ask for a new proposal.');
    const base = scope === 'app' ? state.appTheme : state.currentTheme;
    const saved = expected.preferences as ReturnType<typeof helperPreferences>;
    if (!sameHelperValue(base, scope === 'app' ? saved.appTheme : saved.currentTheme))
      throw new Error('Appearance changed since this proposal. Ask for a new proposal.');
    return { base, theme: helperTheme(base, input as unknown as ThemeChange), scope };
  };
  const apply = async () => {
    setBusy(true);
    setError('');
    let claimed = false;
    try {
      const theme = action.operation === 'set_theme' ? checkTheme() : undefined;
      const patch =
        action.operation === 'set_preferences' ? helperPreferencePatch(input) : undefined;
      if (patch) {
        const current = helperPreferences();
        for (const key of Object.keys(input)) {
          if (
            input[key] != null &&
            !sameHelperValue(current[key as keyof typeof current], expected[key])
          )
            throw new Error('Preferences changed since this proposal. Ask for a new proposal.');
        }
      }
      if (
        action.operation === 'prepare_task' &&
        !useProjectStore.getState().projects.some((p) => p.id === input.project_id)
      )
        throw new Error('This project is no longer available.');
      await nativeTask('helper_action', { id: action.id, decision: 'apply' });
      claimed = true;
      if (theme) checkTheme();
      if (patch) {
        const current = helperPreferences();
        for (const key of Object.keys(input)) {
          if (
            input[key] != null &&
            !sameHelperValue(current[key as keyof typeof current], expected[key])
          )
            throw new Error('Preferences changed while applying. Ask for a new proposal.');
        }
      }
      if (
        action.operation === 'prepare_task' &&
        !useProjectStore.getState().projects.some((p) => p.id === input.project_id)
      )
        throw new Error('This project is no longer available.');
      let result: unknown = { applied: true };
      if (theme) {
        const state = useThemeStore.getState();
        const projects = useProjectStore.getState();
        const project = projects.projects.find((p) => p.id === expected.projectId);
        const ownTheme = project?.preferences?.theme;
        const projectScope = theme.scope === 'project';
        if (projectScope && project)
          projects.updateProjectPreferences(project.id, { theme: theme.theme });
        else state.setAppTheme(theme.theme);
        setPreview(undefined);
        setUndo(() => () => {
          if (useThemeStore.getState().previewing)
            throw new Error('Finish the current preview before undoing.');
          const live = projectScope
            ? useProjectStore.getState().projects.find((p) => p.id === project?.id)?.preferences
                ?.theme
            : useThemeStore.getState().appTheme;
          if (!sameHelperValue(live, theme.theme))
            throw new Error('Appearance changed again. Undo is no longer available.');
          if (projectScope && project)
            useProjectStore.getState().updateProjectPreferences(project.id, { theme: ownTheme });
          else useThemeStore.getState().setAppTheme(theme.base);
        });
        result = { applied: true, theme: theme.theme, scope: projectScope ? 'project' : 'app' };
      } else if (patch) {
        const old = useSettingsStore.getState();
        const previous = Object.fromEntries(
          Object.keys(patch).map((key) => [key, old[key as keyof typeof old]]),
        );
        old.updateSettings(patch);
        setUndo(() => () => {
          const live = useSettingsStore.getState();
          if (
            !Object.entries(patch).every(([key, value]) => live[key as keyof typeof live] === value)
          )
            throw new Error('Preferences changed again. Undo is no longer available.');
          live.updateSettings(previous);
        });
        result = { applied: true, preferences: patch };
      } else if (action.operation === 'set_default_agent') {
        const agent = String(input.agent);
        const config = useAgentConfigStore.getState();
        if (config.defaultMetaAgent !== expected.defaultAgent)
          throw new Error('The default agent changed. Ask for a new proposal.');
        if (
          !useExecutionStore
            .getState()
            .runners.some((runner) => runner.id === agent && runner.available) ||
          config.enabledAgents[agent] === false
        )
          throw new Error('This agent is no longer available or enabled.');
        config.setDefaultMetaAgent(agent);
        try {
          await syncAgentConfig();
        } catch (cause) {
          if (useAgentConfigStore.getState().defaultMetaAgent === agent)
            config.setDefaultMetaAgent(config.defaultMetaAgent);
          throw cause;
        }
        result = { defaultAgent: useAgentConfigStore.getState().defaultMetaAgent };
      } else if (action.operation === 'open_task' || action.operation === 'stop_task') {
        const run = useExecutionStore.getState().runs.find((run) => run.id === input.run_id);
        if (!run) throw new Error('This task is no longer loaded.');
        if (action.operation === 'stop_task') {
          await nativeTask('task_stop', { id: run.id });
          result = { stopRequested: true, runId: run.id };
        } else {
          useProjectStore.getState().selectProject(run.projectId);
          useExecutionStore.getState().select(run.id);
          onNavigate();
          requestAnimationFrame(() =>
            window.dispatchEvent(new CustomEvent('jackalope:navigate', { detail: 'kanban' })),
          );
          result = { openedRunId: run.id };
        }
      } else if (action.operation === 'navigate') {
        const destination = destinations[String(input.destination)];
        if (!destination) throw new Error('Unknown destination.');
        onNavigate();
        requestAnimationFrame(() =>
          window.dispatchEvent(new CustomEvent('jackalope:navigate', { detail: destination })),
        );
      } else if (action.operation === 'prepare_task') {
        const key = `helper-${action.id}`;
        if (useExecutionStore.getState().drafts[key]?.prompt)
          throw new Error('This draft already exists.');
        useExecutionStore.getState().draft(key, {
          prompt: String(input.prompt),
          projectId: String(input.project_id),
          isolated: true,
          agent: '',
        });
        onNavigate();
        requestAnimationFrame(() =>
          window.dispatchEvent(new CustomEvent('jackalope:helper-draft', { detail: key })),
        );
        result = { draftPrepared: true, started: false };
      } else throw new Error('Unsupported action.');
      await nativeTask('helper_action', { id: action.id, decision: 'complete', result });
      await useHelperStore.getState().refresh();
    } catch (cause) {
      setError(String(cause));
      if (claimed)
        await nativeTask('helper_action', {
          id: action.id,
          decision: 'failed',
          result: { error: String(cause) },
        }).catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="helper-action">
      <strong>{labels[action.operation] ?? action.operation}</strong>
      <p className="helper-action-values">
        {Object.entries(input)
          .filter(([, value]) => value != null)
          .map(([key, value]) =>
            key === 'project_id'
              ? `Project: ${projectName ?? 'Unavailable project'}`
              : `${key.replaceAll('_', ' ')}: ${String(value)}`,
          )
          .join(' · ')}
      </p>
      <small>
        {action.source.startsWith('helper:') ? 'From this conversation' : 'From connected agent'} ·{' '}
        {expired ? 'expired' : action.status}
      </small>
      {action.status === 'proposed' && !expired && (
        <div className="helper-buttons">
          {action.operation === 'set_theme' && !preview ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                try {
                  setPreview(checkTheme().theme);
                  setError('');
                } catch (cause) {
                  setError(String(cause));
                }
              }}
            >
              Preview
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void apply()}
              loading={busy}
              loadingLabel={'Applying…'}
            >
              {preview
                ? 'Keep theme'
                : action.operation === 'prepare_task'
                  ? 'Open draft'
                  : 'Apply'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setPreview(undefined);
              void nativeTask('helper_action', { id: action.id, decision: 'dismiss' })
                .then(() => useHelperStore.getState().refresh())
                .catch((cause) => setError(String(cause)));
            }}
          >
            Cancel
          </Button>
        </div>
      )}
      {undo && (
        <button
          type="button"
          className="helper-text-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              undo();
              await nativeTask('helper_action', {
                id: action.id,
                decision: 'undone',
                result: { undone: true },
              });
              setUndo(undefined);
              setError('');
              await useHelperStore.getState().refresh();
            } catch (cause) {
              setError(String(cause));
            } finally {
              setBusy(false);
            }
          }}
        >
          Undo change
        </button>
      )}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </article>
  );
}
