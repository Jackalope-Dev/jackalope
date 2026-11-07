import { AlertTriangle, Laptop, Server } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { hostLoad, type ProjectHosts, projectHosts } from '../../lib/computers';
import { isTauriEnvironment } from '../../lib/native/env';
import './computers.css';

/** How often an open capacity summary re-reads the pool. */
const REFRESH_MS = 5000;

/**
 * A project's capacity pool, re-read while mounted: where its swarms may run,
 * each host's load and health. `refreshMs` of 0 reads once.
 */
export function useProjectHosts(projectId: string | null | undefined, refreshMs = REFRESH_MS) {
  const [hosts, setHosts] = useState<ProjectHosts | null>(null);
  const [error, setError] = useState('');
  const read = useCallback(async () => {
    if (!projectId || !isTauriEnvironment()) return;
    try {
      setHosts(await projectHosts(projectId));
      setError('');
    } catch (cause) {
      setError(String(cause));
    }
  }, [projectId]);
  useEffect(() => {
    setHosts(null);
    void read();
    if (!refreshMs) return;
    const timer = window.setInterval(() => void read(), refreshMs);
    return () => window.clearInterval(timer);
  }, [read, refreshMs]);
  return { hosts, setHosts, error, reload: read };
}

/**
 * A compact line per host of the project's pool: running attempts against its
 * limit, or lost contact. It shows recorded state only.
 */
export function HostCapacity({
  projectId,
  label = 'Hosts',
}: {
  projectId: string | null | undefined;
  label?: string;
}) {
  const { hosts } = useProjectHosts(projectId);
  if (!hosts?.hosts.length) return null;
  return (
    <ul className="host-capacity" aria-label={label}>
      {hosts.hosts.map((host) => {
        const Icon = host.lost ? AlertTriangle : host.device ? Laptop : Server;
        return (
          <li
            key={host.id}
            className="host-capacity-item"
            data-lost={host.lost ? true : undefined}
            title={
              host.lost
                ? host.lost
                : host.lastSeen
                  ? `Last reached ${new Date(host.lastSeen).toLocaleString()}`
                  : undefined
            }
          >
            <Icon size={14} aria-hidden="true" />
            <span className="host-capacity-name">
              {host.name}
              {host.pinned && <span className="host-capacity-note"> · project computer</span>}
            </span>
            <span className="host-capacity-load">{hostLoad(host)}</span>
          </li>
        );
      })}
    </ul>
  );
}
