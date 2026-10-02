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
import { Setting, SettingBody, SettingGroup } from './Setting';

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
    <SettingGroup
      aria-label="This device"
      title={
        <span className="inline-flex items-center gap-2">
          <Monitor size={16} className="text-[var(--color-accent-ink)]" aria-hidden="true" />
          {host?.device_name ?? 'This device'}
        </span>
      }
      description={host ? `This device · ${host.os} · ${host.arch}` : undefined}
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
    >
      {error && (
        <SettingBody>
          <InlineNotice tone="error">{error}</InlineNotice>
        </SettingBody>
      )}
      {host ? (
        <>
          <Setting
            title="Git"
            description={
              host.git_available
                ? 'Git is available for project work.'
                : 'Install Git to open repositories and create worktrees.'
            }
          />
          {host.desktop_control && (
            <Setting title="Native window control" description={host.desktop_control.message}>
              {host.desktop_control.can_request_permissions && !host.desktop_control.available && (
                <Button
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
            </Setting>
          )}
          {host.desktop_control &&
            !host.desktop_control.available &&
            !!host.desktop_control.missing?.length && (
              <SettingBody>
                <p className="task-muted">
                  If macOS did not ask, turn Jackalope on in each pane, then restart the app.
                </p>
                <ul className="flex flex-wrap gap-2" aria-label="Missing macOS permissions">
                  {host.desktop_control.missing.map((permission) => (
                    <li key={permission}>
                      <Button variant="outline" onClick={() => void openSettings(permission)}>
                        Open {PERMISSION_LABELS[permission]}
                      </Button>
                    </li>
                  ))}
                </ul>
                {requested && (
                  <div>
                    <Button
                      disabled={restarting || loading}
                      onClick={() => void restart()}
                      loading={restarting}
                      loadingLabel="Restarting…"
                    >
                      Restart Jackalope
                    </Button>
                  </div>
                )}
              </SettingBody>
            )}
        </>
      ) : (
        <SettingBody>
          <p role="status" className="task-muted">
            {loading
              ? 'Reading device information…'
              : !desktop
                ? 'Device information is available in the desktop app.'
                : 'Device information could not be loaded. Try refreshing.'}
          </p>
        </SettingBody>
      )}
    </SettingGroup>
  );
}
