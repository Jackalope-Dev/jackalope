import { useState } from 'react';
import { Shell } from './components/layout/Shell';
import { OnboardingFlow } from './components/onboarding/OnboardingFlow';

export default function App() {
  const [isOnboardingComplete, setIsOnboardingComplete] = useState<boolean>(() => {
    return localStorage.getItem('jackalope_onboarding_completed') === 'true';
  });

  const handleFinishOnboarding = () => {
    localStorage.setItem('jackalope_onboarding_completed', 'true');
    setIsOnboardingComplete(true);
  };

  const handleRestartOnboarding = () => {
    setIsOnboardingComplete(false);
  };

  return (
    <>
      <Shell onRestartOnboarding={handleRestartOnboarding} />
      {!isOnboardingComplete && (
        <OnboardingFlow onComplete={handleFinishOnboarding} />
      )}
    </>
  );
}
