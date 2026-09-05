import { MotionConfig } from 'motion/react';
import { useEffect, useState } from 'react';
import { nativeTask } from './lib/task-runtime';
import { Shell } from './components/layout/Shell';
import { observeExecution } from './stores/executionStore';
import './components/tasks/task-workspace.css';
import './components/ui/experience.css';

export default function App() {
  const [resetError, setResetError] = useState('');
  const [ready, setReady] = useState(!('__JACKALOPE_RESET__' in window));
  useEffect(() => {
    if (ready) return observeExecution();
    nativeTask('app_finish_reset').then(() => setReady(true)).catch(error => setResetError(String(error)));
  }, [ready]);
  if (!ready) return <main className="p-8"><p role="status">{resetError || 'Finishing reset…'}</p>{resetError && <button type="button" onClick={() => location.reload()}>Retry reset</button>}</main>;

  return (
    <MotionConfig reducedMotion="user">
      <Shell />
    </MotionConfig>
  );
}
