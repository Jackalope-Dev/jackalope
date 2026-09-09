import { startThemeClock } from '@jackalope/brand/theme';
import { MotionConfig } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { AccessBoundary } from './components/account/AccessBoundary';
import { Shell } from './components/layout/Shell';
import { OnboardingFlow } from './components/onboarding/OnboardingFlow';
import { WorkspaceTransition } from './components/onboarding/WorkspaceTransition';
import { observeDesktopControlTheme } from './lib/desktop-control-theme';
import { observeTelemetry } from './lib/observe-telemetry';
import { commitProjectSetup } from './lib/project-setup';
import { nativeTask } from './lib/task-runtime';
import { useCommunityStore } from './stores/communityStore';
import { observeExecution, useExecutionStore } from './stores/executionStore';
import { observeFeedbackActivity } from './stores/feedbackStore';
import { observeNotifications } from './stores/notificationStore';
import { useOnboardingStore } from './stores/onboardingStore';
import { useProjectStore } from './stores/projectStore';
import { observeSettingsSync } from './stores/settingsSyncStore';
import './components/tasks/task-workspace.css';
import './components/ui/experience.css';

export default function App() {
  useEffect(startThemeClock, []);
  useEffect(observeDesktopControlTheme, []);
  useEffect(observeTelemetry, []);
  useEffect(observeFeedbackActivity, []);
  useEffect(observeNotifications, []);
  useEffect(observeSettingsSync, []);
  const [resetError, setResetError] = useState('');
  const [ready, setReady] = useState(!('__JACKALOPE_RESET__' in window));
  const [initialTaskAgent, setInitialTaskAgent] = useState<string>();
  const [initialDraftKey, setInitialDraftKey] = useState<string>();
  const [entry, setEntry] = useState<{
    agent?: string;
    draftKey?: string;
  } | null>(null);
  const [focusWorkspace, setFocusWorkspace] = useState(false);
  const completeEntry = useCallback(() => {
    if (!entry) return;
    const setup = useOnboardingStore.getState();
    const pending = setup.pendingProject;
    const project = pending ? commitProjectSetup(pending) : undefined;
    if (project && setup.firstTask !== null) {
      useExecutionStore.getState().draft(project.id, {
        prompt: setup.firstTask ?? '',
        agent: entry.agent ?? project.preferences?.preferredRunner ?? '',
        projectId: project.id,
      });
    }
    if (entry.draftKey) useExecutionStore.getState().select(null);
    setInitialTaskAgent(entry.agent);
    setInitialDraftKey(entry.draftKey ? (project?.id ?? entry.draftKey) : undefined);
    setFocusWorkspace(true);
    useOnboardingStore.getState().finish();
    setEntry(null);
  }, [entry]);
  const onboarding = useOnboardingStore();
  useEffect(() => {
    if (onboarding.status === 'active') {
      setInitialTaskAgent(undefined);
      setInitialDraftKey(undefined);
    }
  }, [onboarding.status]);
  useEffect(() => {
    if (ready)
      useOnboardingStore.getState().initialize(useProjectStore.getState().projects.length > 0);
  }, [ready]);
  useEffect(() => {
    if (ready) {
      void useCommunityStore.getState().load();
      return observeExecution();
    }
    nativeTask('app_finish_reset')
      .then(() => setReady(true))
      .catch((error) => setResetError(String(error)));
  }, [ready]);
  if (!ready)
    return (
      <main className="p-8">
        <p role="status">{resetError || 'Finishing reset…'}</p>
        {resetError && (
          <button type="button" onClick={() => location.reload()}>
            Retry reset
          </button>
        )}
      </main>
    );

  return (
    <MotionConfig reducedMotion="user">
      <AccessBoundary>
        {entry ? (
          <WorkspaceTransition
            project={onboarding.pendingProject ?? undefined}
            onComplete={completeEntry}
            onBack={() => setEntry(null)}
          />
        ) : onboarding.status === 'new' || onboarding.status === 'active' ? (
          <OnboardingFlow
            onFinish={(agent, draftKey) => setEntry({ agent, draftKey })}
            onSkip={() => setEntry({})}
          />
        ) : (
          <Shell
            initialTaskAgent={initialTaskAgent}
            initialDraftKey={initialDraftKey}
            focusOnMount={focusWorkspace}
          />
        )}
      </AccessBoundary>
    </MotionConfig>
  );
}
