import { EchoMark } from '@jackalope/brand/echo';
import { applyThemeTokens } from '@jackalope/brand/theme';
import { useEffect, useRef, useState } from 'react';
import { prepareWorkspace } from '../../lib/workspace-preparation';
import { type Project, useProjectStore } from '../../stores/projectStore';
import { useThemeStore } from '../../stores/themeStore';
import { ResizeHandles } from '../layout/ResizeHandles';
import { TitleBar } from '../layout/TitleBar';
import { Button } from '../ui/button';
import './onboarding.css';

export function WorkspaceTransition({
  onComplete,
  onBack,
  project: pendingProject,
}: {
  onComplete: () => void;
  onBack: () => void;
  project?: Project;
}) {
  const activeProject = useProjectStore((state) =>
    state.projects.find((item) => item.id === state.activeProjectId),
  );
  const project = pendingProject ?? activeProject;
  const appTheme = useThemeStore((state) => state.appTheme);
  const preview = pendingProject ? (pendingProject.preferences?.theme ?? appTheme) : undefined;
  useEffect(() => {
    if (!preview) return;
    useThemeStore.setState({ previewing: true });
    applyThemeTokens(preview);
    return () => {
      useThemeStore.setState({ previewing: false });
      applyThemeTokens(useThemeStore.getState().currentTheme);
    };
  }, [preview]);
  const [checks, setChecks] = useState<
    {
      id: string;
      label: string;
      state: 'running' | 'complete' | 'failed';
      error?: string;
      optional?: boolean;
    }[]
  >([]);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const finished = useRef(false);
  const preparing =
    !checks.length || checks.some((check) => check.state === 'running' && !check.optional);
  const errors = checks.filter((check) => check.state === 'failed' && !check.optional);
  const error = errors.map((check) => `${check.label}: ${check.error}`).join('\n');

  useEffect(() => {
    heading.current?.focus();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry and project identity restart checks; metadata updates do not.
  useEffect(() => {
    let disposed = false;
    setSlow(false);
    const jobs = prepareWorkspace(project, !!pendingProject);
    setChecks(jobs.map(({ id, label, optional }) => ({ id, label, optional, state: 'running' })));
    const update = (id: string, state: 'complete' | 'failed', cause?: unknown) => {
      if (!disposed)
        setChecks((current) =>
          current.map((check) =>
            check.id === id
              ? { ...check, state, error: cause === undefined ? undefined : String(cause) }
              : check,
          ),
        );
    };
    for (const job of jobs) {
      void job.result.then(
        () => update(job.id, 'complete'),
        (cause) => update(job.id, 'failed', cause),
      );
    }
    const timeout = setTimeout(() => setSlow(true), 8000);
    return () => {
      disposed = true;
      clearTimeout(timeout);
    };
  }, [attempt, project?.id, project?.path]);

  const complete = () => {
    if (finished.current) return;
    finished.current = true;
    onComplete();
  };
  useEffect(() => {
    if (!preparing && !error && !finished.current) {
      finished.current = true;
      onComplete();
    }
  }, [preparing, error, onComplete]);

  return (
    <div className="workspace-transition">
      <ResizeHandles />
      <TitleBar />
      <main className="workspace-transition-content" aria-labelledby="workspace-transition-title">
        <div className="workspace-transition-mark">
          <EchoMark animated={!error && preparing} />
        </div>
        <h1 id="workspace-transition-title" tabIndex={-1} ref={heading}>
          {error
            ? 'Workspace checks need attention'
            : !preparing
              ? 'You’re all set'
              : 'Getting everything ready for you'}
        </h1>
        <p role="status">
          {error
            ? 'You can retry or open the workspace and check there.'
            : preparing
              ? `${checks.find((check) => check.state === 'running')?.label ?? 'Opening your workspace'}…`
              : 'Your next idea has a place to start.'}
        </p>
        <ul className="workspace-transition-checks" aria-label="Workspace preparation">
          {checks.map((check) => (
            <li key={check.id}>
              <span>{check.label}</span>
              <span>
                {check.state === 'complete'
                  ? 'Done'
                  : check.state === 'failed'
                    ? 'Needs attention'
                    : 'In progress'}
              </span>
            </li>
          ))}
        </ul>
        {error && (
          <p className="workspace-transition-error" role="alert">
            {error}
          </p>
        )}
        {slow && preparing && (
          <p>
            Checks are taking longer than expected. You can open the workspace while they finish.
          </p>
        )}
        <div className="workspace-transition-actions">
          {error && <Button onClick={() => setAttempt((value) => value + 1)}>Retry</Button>}
          {(error || slow) && <Button onClick={complete}>Open workspace</Button>}
          <Button variant="ghost" onClick={onBack}>
            Back to setup
          </Button>
        </div>
      </main>
    </div>
  );
}
