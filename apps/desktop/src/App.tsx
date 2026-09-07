import { startThemeClock } from '@jackalope/brand/theme';
import { MotionConfig } from 'motion/react';
import { useEffect, useState } from 'react';
import { Shell } from './components/layout/Shell';
import { OnboardingFlow } from './components/onboarding/OnboardingFlow';
import { PrivacyGate } from './components/settings/PrivacySettings';
import { observeTelemetry } from './lib/observe-telemetry';
import { nativeTask } from './lib/task-runtime';
import { observeExecution } from './stores/executionStore';
import { useOnboardingStore } from './stores/onboardingStore';
import { useProjectStore } from './stores/projectStore';
import './components/tasks/task-workspace.css';
import './components/ui/experience.css';

export default function App() {
  useEffect(startThemeClock, []);
  useEffect(observeTelemetry, []);
  const [resetError, setResetError] = useState('');
  const [ready, setReady] = useState(!('__JACKALOPE_RESET__' in window));
  const [initialTaskAgent, setInitialTaskAgent] = useState<string>();
  const onboarding = useOnboardingStore();
  useEffect(() => {
    if (ready)
      useOnboardingStore.getState().initialize(useProjectStore.getState().projects.length > 0);
  }, [ready]);
  useEffect(() => {
    if (ready) return observeExecution();
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
      <PrivacyGate>
        {onboarding.status === 'new' || onboarding.status === 'active' ? (
          <OnboardingFlow
            onFinish={(agent) => {
              setInitialTaskAgent(agent);
              onboarding.finish(!agent);
            }}
          />
        ) : (
          <Shell initialTaskAgent={initialTaskAgent} />
        )}
      </PrivacyGate>
    </MotionConfig>
  );
}
