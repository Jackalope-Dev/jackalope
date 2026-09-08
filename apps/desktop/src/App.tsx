import { startThemeClock } from '@jackalope/brand/theme';
import { MotionConfig } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { AccessBoundary } from './components/account/AccessBoundary';
import { Shell } from './components/layout/Shell';
import { OnboardingFlow } from './components/onboarding/OnboardingFlow';
import { WorkspaceTransition } from './components/onboarding/WorkspaceTransition';
import { observeTelemetry } from './lib/observe-telemetry';
import { nativeTask } from './lib/task-runtime';
import { useCommunityStore } from './stores/communityStore';
import { observeExecution } from './stores/executionStore';
import { observeNotifications } from './stores/notificationStore';
import { useOnboardingStore } from './stores/onboardingStore';
import { useProjectStore } from './stores/projectStore';
import './components/tasks/task-workspace.css';
import './components/ui/experience.css';

export default function App() {
  useEffect(startThemeClock, []);
  useEffect(observeTelemetry, []);
  useEffect(observeNotifications, []);
  const [resetError, setResetError] = useState('');
  const [ready, setReady] = useState(!('__JACKALOPE_RESET__' in window));
  const [initialTaskAgent, setInitialTaskAgent] = useState<string>();
  const [initialDraftKey, setInitialDraftKey] = useState<string>();
  const [entry, setEntry] = useState<{
    agent: string;
    draftKey: string;
  } | null>(null);
  const [focusWorkspace, setFocusWorkspace] = useState(false);
  const completeEntry = useCallback(() => {
    if (!entry) return;
    void useCommunityStore.getState().applyDefaults();
    setInitialTaskAgent(entry.agent);
    setInitialDraftKey(entry.draftKey);
    setFocusWorkspace(true);
    useOnboardingStore.getState().finish();
    setEntry(null);
  }, [entry]);
  const onboarding = useOnboardingStore();
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
          <WorkspaceTransition onComplete={completeEntry} onBack={() => setEntry(null)} />
        ) : onboarding.status === 'new' || onboarding.status === 'active' ? (
          <OnboardingFlow onFinish={(agent, draftKey) => setEntry({ agent, draftKey })} />
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
