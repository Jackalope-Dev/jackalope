import { Monitor, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSystemInfo, isTauriEnvironment, type SystemInfo } from '../../lib/tauri-bridge';
import { Button } from '../ui/button';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';

export function SystemInfoView() {
  const [host, setHost] = useState<SystemInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
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
          <Button variant="outline" disabled={!desktop || loading} onClick={() => void load()}>
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
