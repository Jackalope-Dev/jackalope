import { Monitor, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getSystemInfo,
  isTauriEnvironment,
  requestDesktopControlPermissions,
  type SystemInfo,
} from '../../lib/tauri-bridge';
import { Button } from '../ui/button';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';

export function SystemInfoView() {
  const [host, setHost] = useState<SystemInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [requestingPermissions, setRequestingPermissions] = useState(false);
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
    } catch (error) {
      setError(String(error));
    } finally {
      setRequestingPermissions(false);
    }
  };
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [load]);
  return (
    <section className="task-page">
      <WorkspaceHeading
        title="Devices"
        action={
          <Button
            variant="outline"
            disabled={!desktop || loading || requestingPermissions}
            onClick={() => void load()}
          >
            <RefreshCw size={16} />
            {loading ? 'Reading…' : 'Refresh device'}
          </Button>
        }
      />
      {error && (
        <p role="alert" className="task-error mb-5">
          {error}
        </p>
      )}
      {host ? (
        <div className="flex items-start gap-5 py-6">
          <Monitor size={32} className="text-[var(--color-accent-ink)] shrink-0" />
          <div>
            <h2 className="text-xl font-medium break-words">{host.device_name}</h2>
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
                    >
                      {requestingPermissions ? 'Checking permissions…' : 'Set up macOS permissions'}
                    </Button>
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
