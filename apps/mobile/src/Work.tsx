import { Badge, Button, EmptyState, InlineNotice, LoadingState } from '@jackalope/ui';
import { Inbox, MessageCircle, Monitor, Plus } from 'lucide-react';
import { Avatar, Bar } from './Bar';
import type { Host } from './native';
import { groupWork, since, workRows } from './status';
import type { ComputerState } from './useComputers';

/**
 * Work across every paired computer in one list, grouped by what it needs from the person.
 * Each computer still runs its own work; with a computer chosen, only its work shows.
 */
export function Work({
  hosts,
  computers,
  only,
  onOpen,
  onCompose,
  onComputers,
  onBack,
  onRetry,
}: {
  hosts: Host[];
  computers: Record<string, ComputerState>;
  only?: Host;
  onOpen: (host: Host, id: string) => void;
  onCompose: (host: Host) => void;
  onComputers: () => void;
  onBack?: () => void;
  onRetry: (host: Host) => void;
}) {
  const shown = only ? [only] : hosts;
  const several = hosts.length > 1 && !only;
  const rows = shown.flatMap((host) =>
    workRows(computers[host.id]?.snapshot ?? null).map((row) => ({ ...row, host })),
  );
  const groups = groupWork(rows);
  const unreachable = shown.filter((host) => computers[host.id]?.error);
  const loading = shown.every((host) => !computers[host.id]);
  // New work goes to the first computer that can take it; New work's form can switch.
  const target = shown.find((host) => computers[host.id]?.snapshot?.projects.length);
  const noProjects =
    !target && shown.every((host) => computers[host.id]?.snapshot || computers[host.id]?.error);
  return (
    <main className="mobile-screen">
      <Bar title={only?.label ?? 'Work'} onBack={onBack}>
        {!only && (
          <button
            type="button"
            className="mobile-icon-button"
            aria-label="Computers"
            onClick={onComputers}
          >
            <Monitor size={20} aria-hidden="true" />
          </button>
        )}
      </Bar>
      {unreachable.map((host) => (
        <InlineNotice
          key={host.id}
          tone="warning"
          action={
            <Button variant="outline" size="sm" onClick={() => onRetry(host)}>
              Retry
            </Button>
          }
        >
          {several && <strong>{host.label}: </strong>}
          {computers[host.id]?.error}
        </InlineNotice>
      ))}
      {loading && <LoadingState label="Loading work…" />}
      {groups.map(
        ([label, items]) =>
          items.length > 0 && (
            <section key={label} className="mobile-section" aria-label={label}>
              <h2>
                {label} <span>{items.length}</span>
              </h2>
              <ul className="mobile-list mobile-card mobile-glass">
                {items.map((row) => (
                  <li key={`${row.host.id}:${row.id}`}>
                    <button
                      type="button"
                      className="mobile-row"
                      onClick={() => onOpen(row.host, row.id)}
                    >
                      {row.agent ? (
                        <Avatar agent={row.agent} working={row.status.working} />
                      ) : (
                        <span className="mobile-host-icon" aria-hidden="true">
                          <MessageCircle size={18} />
                        </span>
                      )}
                      <span className="mobile-row-body">
                        <strong>{row.title}</strong>
                        <span className="mobile-row-meta">
                          <Badge variant={row.status.variant}>{row.status.label}</Badge>
                          <small>
                            {[
                              row.projectName,
                              several && row.host.label,
                              row.startedAt && since(row.startedAt),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </small>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
      {!loading && !rows.length && !unreachable.length && (
        <EmptyState
          icon={Inbox}
          title="No work yet"
          description={
            noProjects
              ? `Choose projects in Settings → Remote access on ${only?.label ?? (shown.length > 1 ? 'one of your computers' : 'your computer')} to start work from here.`
              : undefined
          }
        />
      )}
      <button
        type="button"
        className="mobile-fab"
        disabled={!target}
        onClick={() => target && onCompose(target)}
      >
        <Plus size={20} aria-hidden="true" />
        New work
      </button>
    </main>
  );
}
