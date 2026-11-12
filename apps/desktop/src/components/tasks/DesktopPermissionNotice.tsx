import { describeError } from '@jackalope/contracts/errors';
import { isActive } from '@jackalope/contracts/runs';
import { Button, InlineNotice } from '@jackalope/ui';
import { useEffect, useId, useState } from 'react';
import type { TaskRun } from '../../lib/run-types';
import {
  DESKTOP_PERMISSION_LABELS,
  type DesktopPermission,
  getSystemInfo,
  openDesktopPermissionSettings,
  restartForDesktopPermissions,
} from '../../lib/system-info';
import { ActionError } from '../ui/ActionError';
import { DismissButton } from '../ui/DismissButton';

function names(missing: DesktopPermission[]) {
  const labels = missing.map((permission) => DESKTOP_PERMISSION_LABELS[permission]);
  return labels.length > 1
    ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
    : (labels[0] ?? '');
}

/**
 * Shown after the agent's desktop control was refused for missing macOS permissions,
 * while this device still lacks them. macOS applies a grant only after a restart.
 */
export function DesktopPermissionNotice({ run }: { run: TaskRun }) {
  const reasonId = useId();
  const recorded = run.desktopPermissions ?? [];
  const needed = recorded.length > 0;
  const [current, setCurrent] = useState<DesktopPermission[] | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!needed) return;
    let live = true;
    // Re-read when the person comes back from System Settings.
    const check = () =>
      void getSystemInfo()
        .then((info) => {
          if (live) setCurrent(info.desktop_control?.missing ?? []);
        })
        .catch(() => {
          if (live) setCurrent(null);
        });
    check();
    window.addEventListener('focus', check);
    return () => {
      live = false;
      window.removeEventListener('focus', check);
    };
  }, [needed]);
  const missing = current ?? recorded;
  if (!needed || dismissed || !missing.length) return null;
  const running = isActive(run);
  const open = async (permission: DesktopPermission) => {
    setError('');
    try {
      await openDesktopPermissionSettings(permission);
    } catch (cause) {
      setError(describeError(cause));
    }
  };
  const restart = async () => {
    setRestarting(true);
    setError('');
    try {
      await restartForDesktopPermissions();
    } catch (cause) {
      setError(describeError(cause));
      setRestarting(false);
    }
  };
  return (
    <InlineNotice
      tone="warning"
      action={
        <DismissButton label="Dismiss desktop permissions" onDismiss={() => setDismissed(true)} />
      }
    >
      <p>
        For desktop control, allow Jackalope under {names(missing)} in System Settings. macOS
        applies this after Jackalope restarts.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {missing.map((permission) => (
          <Button
            key={permission}
            variant="outline"
            size="sm"
            onClick={() => void open(permission)}
          >
            Open {DESKTOP_PERMISSION_LABELS[permission]}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={running || restarting}
          aria-describedby={running ? reasonId : undefined}
          loading={restarting}
          loadingLabel="Restarting…"
          onClick={() => void restart()}
        >
          Restart Jackalope
        </Button>
      </div>
      {running && (
        <p id={reasonId} className="task-muted mt-2">
          Restart is available once this work finishes or is stopped.
        </p>
      )}
      <ActionError error={error} />
    </InlineNotice>
  );
}
