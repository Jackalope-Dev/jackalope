import { MotionConfig } from 'motion/react';
import { useEffect } from 'react';
import { Shell } from './components/layout/Shell';
import { observeExecution } from './stores/executionStore';
import './components/tasks/task-workspace.css';

export default function App() {
  useEffect(observeExecution, []);

  return (
    <MotionConfig reducedMotion="user">
      <Shell />
    </MotionConfig>
  );
}
