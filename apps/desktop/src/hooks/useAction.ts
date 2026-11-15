import { describeError } from '@jackalope/contracts/errors';
import { useRef, useState } from 'react';

/**
 * Runs one user action at a time: ignores re-entry while busy, clears the previous error,
 * then runs `after` (usually a refresh) once the action succeeds. Resolves to whether it succeeded.
 */
export function useAction(after?: () => unknown) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const afterRef = useRef(after);
  afterRef.current = after;
  const run = async (work: () => unknown): Promise<boolean> => {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
      await afterRef.current?.();
      return true;
    } catch (cause) {
      setError(describeError(cause));
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return { run, busy, error, setError };
}
