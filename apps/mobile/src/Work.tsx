import { Badge, Button, EmptyState, InlineNotice, LoadingState } from '@jackalope/ui';
import { ChevronRight, Inbox, MessageCircle, Monitor, Plus, Settings2, X } from 'lucide-react';
import { type CSSProperties, useMemo, useState } from 'react';
import { Avatar, Bar, Character } from './Bar';
import { MascotHeader } from './Mascot';
import type { Host } from './native';
import { useProjectIcons } from './projectIcons';
import {
  connectionState,
  groupWork,
  isOlder,
  lastSeen,
  since,
  type WorkRow,
  workAction,
  workRows,
} from './status';
import type { ComputerState } from './useComputers';

type Item = WorkRow & { host: Host; projectIcon?: string };

/** Rows rise in, a little after one another, the first time they appear; never on refresh. */
const enter = (index: number) => ({ '--enter': Math.min(index, 8) }) as CSSProperties;

function meta(row: Item, several: boolean) {
  const project = row.projectHint ? `${row.projectName} (${row.projectHint})` : row.projectName;
  return [project, several && row.host.label, row.startedAt && since(row.startedAt)]
    .filter(Boolean)
    .join(' · ');
}

/** The project's icon from its computer, when it has an image; text carries the name. */
function ProjectIcon({ row }: { row: Item }) {
  return row.projectIcon ? (
    <img className="mobile-project-icon" src={row.projectIcon} alt="" draggable={false} />
  ) : null;
}

/**
 * Work waiting on the person: a card with the agent's character, the title over two
 * lines and the next step as the card's own action at thumb height.
 */
function Card({
  row,
  several,
  offline,
  index,
  onOpen,
}: {
  row: Item;
  several: boolean;
  offline: boolean;
  index: number;
  onOpen: (from: HTMLElement) => void;
}) {
  const { action, showStatus } = workAction(row);
  return (
    <li className="mobile-enter" style={enter(index)}>
      <button
        type="button"
        className="mobile-ask"
        data-offline={offline || undefined}
        disabled={offline}
        aria-label={`${row.title}. ${offline ? 'Its computer is offline.' : action}`}
        onClick={(event) => onOpen(event.currentTarget)}
      >
        <span className="mobile-ask-top">
          {row.agent ? (
            <Character agent={row.agent} state={offline ? 'idle' : 'waiting'} />
          ) : (
            <span className="mobile-character mobile-character-chat" aria-hidden="true">
              <MessageCircle size={22} />
            </span>
          )}
          <span className="mobile-ask-text">
            <strong>{row.title}</strong>
            <span className="mobile-row-meta">
              {showStatus && <Badge variant={row.status.variant}>{row.status.label}</Badge>}
              <ProjectIcon row={row} />
              <small>{meta(row, several)}</small>
            </span>
          </span>
        </span>
        {!offline && (
          <span className="mobile-ask-action" aria-hidden="true">
            {action}
            <ChevronRight size={18} />
          </span>
        )}
      </button>
    </li>
  );
}

/** Work in progress and finished work: one compact line each, its agent beside it. */
function Row({
  row,
  several,
  offline,
  index,
  onOpen,
}: {
  row: Item;
  several: boolean;
  offline: boolean;
  index: number;
  onOpen: (from: HTMLElement) => void;
}) {
  const { action, showStatus } = workAction(row);
  return (
    <li className="mobile-enter" style={enter(index)}>
      <button
        type="button"
        className="mobile-row"
        data-offline={offline || undefined}
        disabled={offline}
        onClick={(event) => onOpen(event.currentTarget)}
      >
        {row.agent ? (
          <Avatar agent={row.agent} working={!offline && row.status.working} />
        ) : (
          <span className="mobile-host-icon" aria-hidden="true">
            <MessageCircle size={18} />
          </span>
        )}
        <span className="mobile-row-body">
          <strong>{row.title}</strong>
          <span className="mobile-row-meta">
            {showStatus && <Badge variant={row.status.variant}>{row.status.label}</Badge>}
            <ProjectIcon row={row} />
            <small>{meta(row, several)}</small>
          </span>
        </span>
        {!offline && (
          <span className="mobile-row-action">
            <span className="mobile-row-action-label">{action}</span>
            <ChevronRight size={16} aria-hidden="true" />
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * Paired computers as a strip of chips under the header: each shows whether this phone
 * reaches it, and choosing one shows only its work. "All" returns to every computer.
 */
function Devices({
  hosts,
  computers,
  only,
  onSelect,
  onComputers,
}: {
  hosts: Host[];
  computers: Record<string, ComputerState>;
  only?: Host;
  onSelect: (host?: Host) => void;
  onComputers: () => void;
}) {
  return (
    <nav className="mobile-devices" aria-label="Computers">
      {hosts.length > 1 && (
        <button
          type="button"
          className="mobile-device"
          aria-pressed={!only}
          onClick={() => onSelect(undefined)}
        >
          All
        </button>
      )}
      {hosts.map((host) => {
        const state = computers[host.id];
        const status = !state ? 'checking' : state.error ? connectionState(state.error) : 'online';
        return (
          <button
            key={host.id}
            type="button"
            className="mobile-device"
            data-status={
              status === 'online' ? 'online' : status === 'checking' ? 'checking' : 'off'
            }
            aria-pressed={only?.id === host.id || (hosts.length === 1 && !only)}
            aria-label={`${host.label}: ${status}${state?.error ? `, ${lastSeen(state.lastSeen)}` : ''}`}
            onClick={() => onSelect(only?.id === host.id ? undefined : host)}
          >
            <span className="mobile-device-dot" aria-hidden="true" />
            <Monitor size={16} aria-hidden="true" />
            <span className="mobile-device-name">{host.label}</span>
          </button>
        );
      })}
      <button
        type="button"
        className="mobile-device mobile-device-manage"
        aria-label="Manage computers"
        onClick={onComputers}
      >
        <Settings2 size={16} aria-hidden="true" />
      </button>
    </nav>
  );
}

/**
 * Work across every paired computer in one list, grouped by what it needs from the person.
 * Each computer still runs its own work; with a computer chosen, only its work shows.
 */
export function Work({
  hosts,
  computers,
  only,
  welcome,
  onOpen,
  onCompose,
  onComputers,
  onSelect,
  onBack,
  onRetry,
}: {
  hosts: Host[];
  computers: Record<string, ComputerState>;
  only?: Host;
  /** A computer this phone has just paired with, greeted once at the top. */
  welcome?: Host;
  onOpen: (host: Host, id: string, from: HTMLElement) => void;
  onCompose: (host: Host, from: HTMLElement) => void;
  onComputers: () => void;
  onSelect: (host?: Host) => void;
  onBack?: () => void;
  onRetry: (host: Host) => void;
}) {
  const shown = only ? [only] : hosts;
  const several = hosts.length > 1 && !only;
  const snapshots = useMemo(
    () => Object.fromEntries(shown.map((host) => [host.id, computers[host.id]?.snapshot])),
    [shown, computers],
  );
  const projectIcon = useProjectIcons(snapshots);
  const rows: Item[] = shown.flatMap((host) =>
    workRows(computers[host.id]?.snapshot ?? null).map((row) => ({
      ...row,
      host,
      projectIcon: projectIcon(host.id, row.projectId),
    })),
  );
  const groups = groupWork(rows);
  const unreachable = shown.filter((host) => computers[host.id]?.error);
  // Hidden per computer and error; a different error brings the notice back. The computer's
  // chip and its read-only rows still show it's offline.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const noticeKey = (host: Host) => `${host.id}\n${computers[host.id]?.error ?? ''}`;
  const loading = shown.every((host) => !computers[host.id]);
  // New work goes to the first computer that can take it; New work's form can switch.
  const target = shown.find((host) => computers[host.id]?.snapshot?.projects.length);
  const noProjects =
    !target && shown.every((host) => computers[host.id]?.snapshot || computers[host.id]?.error);
  const offline = (row: Item) => Boolean(computers[row.host.id]?.error);
  const activity = {
    needsYou: rows.filter((row) => row.status.needsYou && !offline(row)).length,
    working: rows.filter((row) => row.status.working && !offline(row)).length,
    unreachable: unreachable.map((host) => host.label),
    computers: shown.length,
    loading,
  };
  return (
    <main className="mobile-screen mobile-home">
      {onBack ? (
        <Bar title={only?.label ?? 'Work'} onBack={onBack} />
      ) : (
        <MascotHeader title={only?.label ?? 'Work'} activity={activity} />
      )}
      {!onBack && (
        <Devices
          hosts={hosts}
          computers={computers}
          only={only}
          onSelect={onSelect}
          onComputers={onComputers}
        />
      )}
      {welcome && (
        <InlineNotice tone="success" className="mobile-welcome" role="status">
          Paired with {welcome.label}. Its shared projects show here.
        </InlineNotice>
      )}
      {unreachable.map((host) => {
        if (hidden.has(noticeKey(host))) return null;
        const state = computers[host.id];
        const known = workRows(state?.snapshot ?? null).length > 0;
        return (
          <InlineNotice
            key={host.id}
            tone="warning"
            className="mobile-offline"
            action={
              <span className="mobile-offline-actions">
                <Button variant="outline" size="sm" onClick={() => onRetry(host)}>
                  Retry
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Dismiss ${host.label} offline notice`}
                  onClick={() => setHidden((current) => new Set(current).add(noticeKey(host)))}
                >
                  <X size={18} aria-hidden="true" />
                </Button>
              </span>
            }
          >
            <strong className="mobile-offline-title">
              {host.label} · {connectionState(state?.error ?? '')} · {lastSeen(state?.lastSeen)}
            </strong>
            <span className="mobile-offline-note">
              {known
                ? 'Its last-known work is shown below and opens again once it’s back. Work keeps running there.'
                : 'Work keeps running there; it shows here once this phone reaches it again.'}
            </span>
            <details>
              <summary>Details</summary>
              <p>{state?.error}</p>
            </details>
          </InlineNotice>
        );
      })}
      {loading && <LoadingState label="Loading work…" />}
      {groups.map(([label, items]) => {
        if (!items.length) return null;
        const asks = label === 'Needs you';
        // Waiting work from over a week ago sits under "Older" so fresh asks lead.
        const older = asks ? items.filter((row) => isOlder(row)) : [];
        const recent = items.filter((row) => !older.includes(row));
        const list = (part: Item[], cards: boolean) => (
          <ul className={cards ? 'mobile-asks' : 'mobile-list mobile-card mobile-glass'}>
            {part.map((row, index) => {
              const Entry = cards ? Card : Row;
              return (
                <Entry
                  key={`${row.host.id}:${row.id}`}
                  row={row}
                  several={several}
                  offline={offline(row)}
                  index={index}
                  onOpen={(from) => onOpen(row.host, row.id, from)}
                />
              );
            })}
          </ul>
        );
        return (
          <section
            key={label}
            className="mobile-section"
            data-group={label === 'Needs you' ? 'asks' : label === 'Working' ? 'working' : 'done'}
            aria-label={label}
          >
            <h2>
              {label} <span>{items.length}</span>
            </h2>
            {recent.length > 0 && list(recent, asks)}
            {older.length > 0 && (
              <>
                <h3 className="mobile-subheading">Older</h3>
                {list(older, false)}
              </>
            )}
          </section>
        );
      })}
      {!loading && !rows.length && !unreachable.length && (
        <EmptyState
          icon={Inbox}
          title="No work yet"
          description={
            noProjects
              ? `Choose projects in Devices → Let devices use this one on ${only?.label ?? (shown.length > 1 ? 'one of your computers' : 'your computer')} to start work from here.`
              : 'Start something below; it runs on your computer and shows up here.'
          }
        />
      )}
      <button
        type="button"
        className="ui-button mobile-fab"
        data-variant="primary"
        data-size="lg"
        disabled={!target}
        onClick={(event) => target && onCompose(target, event.currentTarget)}
      >
        <Plus size={20} aria-hidden="true" />
        New work
      </button>
    </main>
  );
}
