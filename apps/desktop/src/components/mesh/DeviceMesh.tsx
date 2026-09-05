import { Monitor } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getSystemInfo, type SystemInfo } from '../../lib/tauri-bridge';
import { EmptyState } from '../ui/EmptyState';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';

export function DeviceMesh() {
  const [host, setHost] = useState<SystemInfo | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let canceled = false;
    void getSystemInfo().then(
      (info) => {
        if (!canceled) setHost(info);
      },
      (reason) => {
        if (!canceled) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      canceled = true;
    };
  }, []);
  return (
    <section className="task-page">
      <WorkspaceHeading
        title="Devices"
        description="Your local workspace and device connections."
      />
      {host ? (
        <div className="mb-6 space-y-2">
          <h2 className="text-sm font-semibold">This device</h2>
          <p className="break-words">{host.device_name}</p>
          <p className="task-muted">
            {host.os} · {host.arch}
          </p>
        </div>
      ) : (
        <p className="task-muted mb-6" role="status">
          {error || 'Reading device information…'}
        </p>
      )}
      <EmptyState
        icon={Monitor}
        title="Device pairing is not available yet"
        description="Tasks currently run on the computer where you opened Jackalope."
      />
    </section>
  );
}
