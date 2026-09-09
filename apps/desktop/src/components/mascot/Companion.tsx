import * as Popover from '@radix-ui/react-popover';
import {
  ArrowUpRight,
  Check,
  CircleCheck,
  CircleHelp,
  Info,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isActive, statusLabel } from '../../lib/task-runtime';
import { taskTitle } from '../../lib/task-title';
import {
  type CompanionNotice,
  shouldNotify,
  sortNotices,
  useCompanionStore,
} from '../../stores/companionStore';
import { useExecutionStore } from '../../stores/executionStore';
import { useMascotStore } from '../../stores/mascotStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { openCompanionTask } from './CompanionSources';
import { JackalopeMascot } from './JackalopeMascot';
import { returnToCompanion } from './useCompanionNotices';
import './companion.css';

export function Companion({
  onSearch,
  onSettings,
}: {
  onSearch: () => void;
  onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const interactedOutside = useRef(false);
  const pendingAction = useRef<(() => void) | null>(null);
  const [hint, setHint] = useState<Pick<CompanionNotice, 'id' | 'title' | 'kind'> | null>(null);
  const { sources, readIds, markRead } = useCompanionStore();
  const runs = useExecutionStore((state) => state.runs);
  const loading = useExecutionStore((state) => state.loading);
  const error = useExecutionStore((state) => state.error);
  const mood = useMascotStore((state) => state.mood);
  const message = useMascotStore((state) => state.message);
  const reactions = useSettingsStore((state) => state.mascotReactions);
  const level = useSettingsStore((state) => state.notifications);
  const notices = sortNotices(Object.values(sources).flat());
  const unread = notices.filter((notice) => !readIds.includes(notice.id));
  const announce = unread.filter((notice) => shouldNotify(notice.kind, level));
  const announcementKey = JSON.stringify(
    announce.map(({ id, title, kind }) => ({ id, title, kind })),
  );
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const current: Pick<CompanionNotice, 'id' | 'title' | 'kind'>[] = JSON.parse(announcementKey);
    const next = current.find((notice) => !seen.current.has(notice.id));
    for (const notice of current) seen.current.add(notice.id);
    if (next && !open) setHint(next);
  }, [announcementKey, open]);
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(null), 6000);
    return () => clearTimeout(timer);
  }, [hint]);
  useEffect(() => {
    if (open) setHint(null);
  }, [open]);
  const active = runs.filter(isActive);
  const waiting = active.filter((run) =>
    run.prompts?.some((prompt) => prompt.status === 'pending'),
  );
  const activity = loading
    ? 'Checking activity…'
    : error
      ? 'Activity unavailable'
      : active.length
        ? `${active.length} ${active.length === 1 ? 'task' : 'tasks'} active${waiting.length ? ` · ${waiting.length} waiting for you` : ''}`
        : 'No tasks running';
  const currentMood = error
    ? 'idle'
    : waiting.length
      ? 'thinking'
      : active.length
        ? 'working'
        : hint?.kind === 'success'
          ? 'success'
          : mood;
  const activate = (action: () => void) => {
    pendingAction.current = action;
    setOpen(false);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <footer className="companion-dock">
        <div className="companion-caption" aria-hidden="true">
          <span>{announce.length ? `${announce.length} unread` : 'Jackalope'}</span>
          <small>{activity}</small>
        </div>
        <Popover.Anchor asChild>
          <div className="companion-anchor">
            {!open &&
              !message &&
              hint &&
              !readIds.includes(hint.id) &&
              shouldNotify(hint.kind, level) && (
                <div key={hint.id} className="companion-hint" data-motion={reactions} role="status">
                  {hint.title}
                </div>
              )}
            <JackalopeMascot
              size="sm"
              className="companion-avatar"
              showBubble={!open}
              bubbleAlign="end"
              overrideMood={currentMood}
              reduceMotion={!reactions}
              onActivate={() => setOpen((value) => !value)}
              buttonId="jackalope-companion-trigger"
              expanded={open}
              controls={open ? 'jackalope-companion-panel' : undefined}
              label={`Open Jackalope helper${announce.length ? `, ${announce.length} unread notifications` : ''}. ${activity}`}
            />
            {!!announce.length && (
              <span className="companion-badge" aria-hidden="true">
                {announce.length > 99 ? '99+' : announce.length}
              </span>
            )}
          </div>
        </Popover.Anchor>
      </footer>
      <Popover.Portal>
        <Popover.Content
          id="jackalope-companion-panel"
          className="companion-panel"
          side="top"
          align="end"
          sideOffset={12}
          collisionPadding={16}
          aria-label="Jackalope helper"
          onInteractOutside={(event) => {
            if (
              document.getElementById('jackalope-companion-trigger')?.contains(event.target as Node)
            )
              event.preventDefault();
            else interactedOutside.current = true;
          }}
          onCloseAutoFocus={(event) => {
            if (interactedOutside.current) event.preventDefault();
            else returnToCompanion(event);
            interactedOutside.current = false;
            const action = pendingAction.current;
            pendingAction.current = null;
            if (action) requestAnimationFrame(action);
          }}
        >
          <header className="companion-header">
            <div>
              <h2>Here when you need me</h2>
              <p>{activity}</p>
            </div>
            <Popover.Close className="quiet-icon" aria-label="Close Jackalope helper">
              <X size={18} />
            </Popover.Close>
          </header>
          <div className="companion-content">
            <div className="companion-section-heading">
              <h3>Notifications</h3>
              {!!unread.length && (
                <button type="button" onClick={() => markRead(unread.map((notice) => notice.id))}>
                  <Check size={14} /> Mark all read
                </button>
              )}
            </div>
            {notices.length ? (
              <ul className="companion-notices">
                {notices.map((notice) => {
                  const Icon =
                    notice.kind === 'attention'
                      ? CircleHelp
                      : notice.kind === 'success'
                        ? CircleCheck
                        : Info;
                  const isUnread = !readIds.includes(notice.id);
                  return (
                    <li key={notice.id} data-kind={notice.kind} data-unread={isUnread}>
                      <Icon size={18} className="companion-notice-icon" aria-hidden="true" />
                      <div className="companion-notice-body">
                        <h4>
                          {notice.title}
                          {isUnread && <span className="companion-unread">Unread</span>}
                        </h4>
                        <p>{notice.detail}</p>
                        <div className="companion-notice-actions">
                          {notice.onOpen && (
                            <button
                              type="button"
                              onClick={() => {
                                markRead([notice.id]);
                                activate(notice.onOpen as () => void);
                              }}
                            >
                              {notice.actionLabel ?? 'View details'}
                              <ArrowUpRight size={14} />
                            </button>
                          )}
                          {isUnread && (
                            <button
                              type="button"
                              aria-label={`Mark ${notice.title} as read`}
                              onClick={() => markRead([notice.id])}
                            >
                              Mark read
                            </button>
                          )}
                          {notice.onDismiss && (
                            <button type="button" onClick={notice.onDismiss}>
                              Dismiss
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="companion-empty">
                <CircleCheck size={22} aria-hidden="true" />
                <p>Nothing needs your attention.</p>
                <span>Questions, results and app updates will appear here.</span>
              </div>
            )}
            {!!active.length && (
              <section className="companion-activity">
                <h3>{error ? 'Last known activity' : 'In progress'}</h3>
                <ul>
                  {active.map((run) => (
                    <li key={run.id}>
                      <button type="button" onClick={() => activate(() => openCompanionTask(run))}>
                        <span>
                          {taskTitle(run.prompt)}
                          <small>
                            {run.projectName} ·{' '}
                            {run.prompts?.some((prompt) => prompt.status === 'pending')
                              ? 'Waiting for your answer'
                              : statusLabel[run.status]}
                          </small>
                        </span>
                        <ArrowUpRight size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <div className="companion-shortcuts">
            <button type="button" onClick={() => activate(onSearch)}>
              <Search size={16} /> Find anything
            </button>
            <button type="button" onClick={() => activate(onSettings)}>
              <Settings2 size={16} /> Preferences
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
