import { EchoMark } from '@jackalope/brand/echo';
import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useExecutionStore } from '../../stores/executionStore';
import { ResizeHandles } from '../layout/ResizeHandles';
import { TitleBar } from '../layout/TitleBar';
import { Button } from '../ui/button';
import './onboarding.css';

export function WorkspaceTransition({
  onComplete,
  onBack,
}: {
  onComplete: () => void;
  onBack: () => void;
}) {
  const reduced = useReducedMotion();
  const discovering = useExecutionStore((state) => state.discovering);
  const [refreshing, setRefreshing] = useState(true);
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const finished = useRef(false);

  useEffect(() => {
    heading.current?.focus();
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry restarts preparation and both timers.
  useEffect(() => {
    let disposed = false;
    setRefreshing(true);
    setError('');
    setSlow(false);
    setMinimumElapsed(false);
    const minimum = setTimeout(() => setMinimumElapsed(true), reduced ? 0 : 1600);
    const timeout = setTimeout(() => setSlow(true), 8000);
    void useExecutionStore
      .getState()
      .refresh()
      .then(() => {
        if (disposed) return;
        setError(useExecutionStore.getState().error ?? '');
        setRefreshing(false);
      })
      .catch((cause) => {
        if (disposed) return;
        setError(String(cause));
        setRefreshing(false);
      });
    return () => {
      disposed = true;
      clearTimeout(minimum);
      clearTimeout(timeout);
    };
  }, [attempt, reduced]);
  useEffect(() => {
    if (minimumElapsed && !refreshing && !discovering && !error && !finished.current) {
      finished.current = true;
      onComplete();
    }
  }, [minimumElapsed, refreshing, discovering, error, onComplete]);

  return (
    <div className="workspace-transition">
      <ResizeHandles />
      <TitleBar />
      <main className="workspace-transition-content" aria-labelledby="workspace-transition-title">
        <div className="workspace-transition-mark">
          <EchoMark animated={!error} />
        </div>
        <h1 id="workspace-transition-title" tabIndex={-1} ref={heading}>
          {error ? 'Workspace checks need attention' : 'Opening your workspace'}
        </h1>
        <p role="status">
          {error
            ? 'You can retry or open the workspace and check there.'
            : refreshing
              ? 'Loading task history…'
              : discovering
                ? 'Checking installed agents…'
                : 'Preparing the workspace…'}
        </p>
        {error && (
          <p className="workspace-transition-error" role="alert">
            {error}
          </p>
        )}
        {slow && !error && (
          <p>
            Checks are taking longer than expected. You can open the workspace while they finish.
          </p>
        )}
        <div className="workspace-transition-actions">
          {error && <Button onClick={() => setAttempt((value) => value + 1)}>Retry</Button>}
          {(error || slow) && <Button onClick={onComplete}>Open workspace</Button>}
          <Button variant="ghost" onClick={onBack}>
            Back to setup
          </Button>
        </div>
      </main>
    </div>
  );
}
