import { RefreshIcon } from '@jackalope/ui';
import { Monitor } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type DesktopPermission,
  getSystemInfo,
  isTauriEnvironment,
  openDesktopPermissionSettings,
  requestDesktopControlPermissions,
  restartForDesktopPermissions,
  type SystemInfo,
} from '../../lib/tauri-bridge';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';

const PERMISSION_LABELS: Record<DesktopPermission, string> = {
  accessibility: 'Accessibility',
  screenRecording: 'Screen Recording',
  inputMonitoring: 'Input Monitoring',
};

export function SystemInfoView() {
  const [host, setHost] = useState<SystemInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [requestingPermissions, setRequestingPermissions] = useState(false);
  const [requested, setRequested] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const request = useRef(0);
  const desktop = isTauriEnvironment();
  const load = useCallback(async () => {
    if (!isTauriEnvironment()) return;
    const id = ++request.current;
    setLoading(true);
    setError('');
    try {
      const info = await getSystemInfo();
      if (id === request.current) setHost(info);
    } catch (error) {
      if (id === request.current) setError(String(error));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);
  const requestPermissions = async () => {
    setRequestingPermissions(true);
    setError('');
    try {
      const readiness = await requestDesktopControlPermissions();
      setHost((current) => (current ? { ...current, desktop_control: readiness } : current));
      setRequested(true);
    } catch (error) {
      setError(String(error));
    } finally {
      setRequestingPermissions(false);
    }
  };
  const openSettings = async (permission: DesktopPermission) => {
    setError('');
    try {
      await openDesktopPermissionSettings(permission);
      setRequested(true);
    } catch (error) {
      setError(String(error));
    }
  };
  const restart = async () => {
    setRestarting(true);
    setError('');
    try {
      await restartForDesktopPermissions();
    } catch (error) {
      setError(String(error));
      setRestarting(false);
    }
  };
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [load]);
  return (
    <section className="workspace-section">
      <WorkspaceSectionHeading
        title="Devices"
        level={3}
        action={
          <Button
            variant="outline"
            disabled={!desktop || loading || requestingPermissions}
            onClick={() => void load()}
            loading={loading}
            loadingLabel="Reading…"
          >
            <RefreshIcon size={16} />
            Refresh device
          </Button>
        }
      />
      {error && (
        <InlineNotice tone="error" className="mb-5">
          {error}
        </InlineNotice>
      )}
      {host ? (
        <div className="flex items-start gap-5 py-6">
          <Monitor size={32} className="text-[var(--color-accent-ink)] shrink-0" />
          <div>
            <h3 className="text-xl font-medium break-words">{host.device_name}</h3>
            <p className="task-muted mt-2">
              This device · {host.os} · {host.arch}
            </p>
            {host.desktop_control && (
              <div className="mt-6 max-w-2xl">
                <h3 className="font-medium">Native window control</h3>
                <p className="task-muted mt-2" role="status">
                  {host.desktop_control.message}
                </p>
                {host.desktop_control.can_request_permissions &&
                  !host.desktop_control.available && (
                    <Button
                      className="mt-3"
                      variant="outline"
                      disabled={requestingPermissions || loading}
                      onClick={() => void requestPermissions()}
                      loading={requestingPermissions}
                      loadingLabel="Setting up…"
                    >
                      {host.os === 'linux'
                        ? 'Install GNOME window control'
                        : 'Set up macOS permissions'}
                    </Button>
                  )}
                {!host.desktop_control.available && !!host.desktop_control.missing?.length && (
                  <div className="mt-4">
                    <p className="task-muted">
                      If macOS did not ask, turn Jackalope on in each pane, then restart the app.
                    </p>
                    <ul
                      className="mt-2 flex flex-wrap gap-2"
                      aria-label="Missing macOS permissions"
                    >
                      {host.desktop_control.missing.map((permission) => (
                        <li key={permission}>
                          <Button variant="outline" onClick={() => void openSettings(permission)}>
                            Open {PERMISSION_LABELS[permission]}
                          </Button>
                        </li>
                      ))}
                    </ul>
                    {requested && (
                      <Button
                        className="mt-3"
                        disabled={restarting || loading}
                        onClick={() => void restart()}
                        loading={restarting}
                        loadingLabel="Restarting…"
                      >
                        Restart Jackalope
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
            <p className="task-muted mt-2">
              {host.git_available
                ? 'Git is available for project work.'
                : 'Install Git to open repositories and create worktrees.'}
            </p>
          </div>
        </div>
      ) : (
        <p role="status" className="task-muted">
          {loading
            ? 'Reading device information…'
            : !desktop
              ? 'Device information is available in the desktop app.'
              : 'Device information could not be loaded. Try refreshing.'}
        </p>
      )}
    </section>
  );
}
