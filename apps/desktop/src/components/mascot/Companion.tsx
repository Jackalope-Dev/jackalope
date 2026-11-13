import { isActive, statusLabel } from '@jackalope/contracts/runs';
import { Button, ExternalLinkIcon, Popover, SearchIcon, SegmentedNav } from '@jackalope/ui';
import { ArrowLeft, Check, CircleCheck, CircleHelp, Info, Settings2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { navigateWorkspace } from '../../lib/app-events';
import {
  announcedIds,
  type CompanionHint,
  coalesce,
  companionBadge,
  freshNotices,
  hintStillRelevant,
  markAnnounced,
} from '../../lib/companion-announce';
import { isTauriEnvironment } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import { runTitle } from '../../lib/task-title';
import { selectWork } from '../../lib/work-selection';
import {
  type CompanionNotice,
  shouldNotify,
  sortNotices,
  useCompanionStore,
} from '../../stores/companionStore';
import { useExecutionStore } from '../../stores/executionStore';
import { useHelperStore } from '../../stores/helperStore';
import { useMascotStore } from '../../stores/mascotStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { useNeedsYouCount } from '../layout/WorkSidebar';
import { AskJackalope } from './AskJackalope';
import { CompanionSettings } from './CompanionSettings';
import { openCompanionTask } from './CompanionSources';
import { JackalopeMascot } from './JackalopeMascot';
import { MascotSpeech } from './MascotSpeech';
import { returnToCompanion } from './useCompanionNotices';
import './companion.css';

export function Companion({
  onSearch,
  onSettings,
  compact = false,
}: {
  onSearch: () => void;
  onSettings: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<'ask' | 'activity'>('ask');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (settingsOpen) backButton.current?.focus();
  }, [settingsOpen]);
  const helperWorking = useHelperStore((state) =>
    state.view.turns.some((turn) => turn.status === 'working'),
  );
  const proposals = useHelperStore(
    (state) =>
      state.view.actions.filter(
        (action) => action.status === 'proposed' && Date.now() - action.createdAt < 600_000,
      ).length,
  );
  const interactedOutside = useRef(false);
  const pendingAction = useRef<(() => void) | null>(null);
  const [hint, setHint] = useState<CompanionHint | null>(null);
  const { sources, readIds, markRead, markUnread } = useCompanionStore(
    useShallow((s) => ({
      sources: s.sources,
      readIds: s.readIds,
      markRead: s.markRead,
      markUnread: s.markUnread,
    })),
  );
  const runs = useExecutionStore((state) => state.runs);
  const loading = useExecutionStore((state) => state.loading);
  const error = useExecutionStore((state) => state.error);
  const mood = useMascotStore((state) => state.mood);
  const message = useMascotStore((state) => state.message);
  const reactions = useSettingsStore((state) => state.mascotReactions);
  const level = useSettingsStore((state) => state.notifications);
  const notices = sortNotices(Object.values(sources).flat());
  const unread = notices.filter((notice) => !readIds.includes(notice.id));
  const needsYou = useNeedsYouCount();
  const badge = companionBadge({ needsYou, notices, readIds, proposals });
  useEffect(() => {
    if (isTauriEnvironment())
      void invokeNative('desktop_unread_badge', { count: badge }).catch(() => {});
  }, [badge]);
  const onWorkList = useCompanionStore((state) => state.onWorkList);
  const viewing = useWorkViewStore((state) => state.viewing);
  // Announce transitions only: whatever exists once history first loads is recorded as already
  // announced, and every id is remembered across launches, so restarts never repeat a bubble.
  const noticeKey = notices.map(({ id, kind }) => `${id}|${kind}`).join('\n');
  const seeded = useRef(false);
  const arrivals = useRef<CompanionNotice[]>([]);
  const flush = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef({ notices, readIds, level, open, quiet: false });
  live.current = { notices, readIds, level, open, quiet: onWorkList && !viewing };
  // biome-ignore lint/correctness/useExhaustiveDependencies: noticeKey stands in for notices.
  useEffect(() => {
    if (loading) return;
    const current = live.current.notices;
    if (!seeded.current) {
      seeded.current = true;
      markAnnounced(current.map((notice) => notice.id));
      return;
    }
    const fresh = freshNotices(current, announcedIds(), true);
    if (!fresh.length) return;
    markAnnounced(fresh.map((notice) => notice.id));
    const { readIds: read, level: wanted, open: panelOpen, quiet } = live.current;
    // Work the open list already shows, or the open panel, needs no bubble.
    if (panelOpen || quiet) return;
    arrivals.current.push(
      ...fresh.filter((notice) => !read.includes(notice.id) && shouldNotify(notice.kind, wanted)),
    );
    if (!arrivals.current.length || flush.current) return;
    // Arrivals within a moment of each other share one bubble.
    flush.current = setTimeout(() => {
      flush.current = null;
      const batch = arrivals.current;
      arrivals.current = [];
      setHint((shown) => coalesce(batch, shown));
    }, 1200);
  }, [noticeKey, loading]);
  useEffect(
    () => () => {
      if (flush.current) clearTimeout(flush.current);
    },
    [],
  );
  // A bubble clears itself once nothing it announced still waits.
  useEffect(() => {
    if (hint && !hintStillRelevant(hint, notices)) setHint(null);
  }, [hint, notices]);
  const hintNotice =
    hint?.ids.length === 1 ? notices.find((notice) => notice.id === hint.id) : undefined;
  const openNeedsYou = () => {
    selectWork();
    useWorkViewStore.getState().setScope('all');
    useWorkViewStore.getState().openList('attention');
    navigateWorkspace('kanban');
  };
  const hintAction: { label: string; ids: string[]; run: () => void } | undefined = hint
    ? hint.ids.length > 1
      ? { label: 'Open Work', ids: hint.ids, run: openNeedsYou }
      : hintNotice?.onOpen && hintNotice.actionLabel
        ? { label: hintNotice.actionLabel, ids: [hintNotice.id], run: hintNotice.onOpen }
        : undefined
    : undefined;
  useEffect(() => {
    if (!hint) return;
    // A bubble with an action stays long enough to reach it.
    const timer = setTimeout(() => setHint(null), hintAction ? 20_000 : 6000);
    return () => clearTimeout(timer);
  }, [hint, hintAction]);
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
      : active.length || helperWorking
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
      <div className={compact ? 'companion-dock companion-inline' : 'companion-dock'}>
        <div className="companion-caption" aria-hidden="true" hidden={compact}>
          <span>{badge ? `${badge} need${badge === 1 ? 's' : ''} you` : 'Jackalope'}</span>
          <small>{activity}</small>
        </div>
        <Popover.Anchor asChild>
          <div className="companion-anchor">
            {!open && !message && hint?.ids.some((id) => !readIds.includes(id)) && (
              <MascotSpeech
                key={hint.id}
                motion={reactions}
                dismissLabel="Dismiss notification preview"
                onDismiss={() => setHint(null)}
              >
                {hint.title}
                {hintAction && (
                  <button
                    type="button"
                    className="mascot-speech-action"
                    onClick={() => {
                      setHint(null);
                      markRead(hintAction.ids);
                      hintAction.run();
                    }}
                  >
                    {hintAction.label}
                  </button>
                )}
              </MascotSpeech>
            )}
            <JackalopeMascot
              size={compact ? 'xs' : 'sm'}
              className="companion-avatar"
              showBubble={!open}
              overrideMood={currentMood}
              reduceMotion={!reactions}
              onActivate={() => setOpen((value) => !value)}
              buttonId="jackalope-companion-trigger"
              expanded={open}
              controls={open ? 'jackalope-companion-panel' : undefined}
              label={`Open Jackalope helper${badge ? `, ${badge} need${badge === 1 ? 's' : ''} you` : ''}${proposals ? `, including ${proposals} actions to review` : ''}. ${activity}`}
            />
            {!!badge && (
              <span className="companion-badge" aria-hidden="true">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </div>
        </Popover.Anchor>
      </div>
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
              <h2>{settingsOpen ? 'Helper settings' : 'Ask Jackalope'}</h2>
            </div>
            <div className="companion-header-actions">
              <button
                type="button"
                className="quiet-icon"
                ref={settingsOpen ? backButton : settingsButton}
                aria-label={settingsOpen ? 'Back to helper' : 'Helper settings'}
                onClick={() => {
                  setSettingsOpen(!settingsOpen);
                  if (settingsOpen) requestAnimationFrame(() => settingsButton.current?.focus());
                }}
              >
                {settingsOpen ? <ArrowLeft size={18} /> : <Settings2 size={18} />}
              </button>
              <Popover.Close className="quiet-icon" aria-label="Close Jackalope helper">
                <X size={18} />
              </Popover.Close>
            </div>
          </header>
          {settingsOpen ? (
            <CompanionSettings />
          ) : (
            <>
              <SegmentedNav
                className="helper-tabs"
                label="Helper sections"
                value={section}
                onChange={setSection}
                items={[
                  { id: 'ask', label: 'Ask', count: proposals || undefined },
                  { id: 'activity', label: 'Activity', count: unread.length || undefined },
                ]}
              />
              {section === 'ask' ? (
                <AskJackalope onNavigate={() => setOpen(false)} />
              ) : (
                <>
                  <div className="companion-content">
                    <div className="companion-section-heading">
                      <h3>Notifications</h3>
                      {!!unread.length && (
                        <button
                          type="button"
                          onClick={() => markRead(unread.map((notice) => notice.id))}
                        >
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
                              <Icon
                                size={18}
                                className="companion-notice-icon"
                                aria-hidden="true"
                              />
                              <div className="companion-notice-body">
                                <h4>
                                  {notice.title}
                                  {isUnread && <span className="companion-unread">Unread</span>}
                                </h4>
                                <p>{notice.detail}</p>
                                <div className="companion-notice-actions">
                                  {notice.onOpen && (
                                    <Button
                                      size="sm"
                                      onClick={() => {
                                        markRead([notice.id]);
                                        activate(notice.onOpen as () => void);
                                      }}
                                    >
                                      {notice.actionLabel ?? 'View details'}
                                      <ExternalLinkIcon size={16} />
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    aria-label={`Mark ${notice.title} as ${isUnread ? 'read' : 'unread'}`}
                                    onClick={() =>
                                      isUnread ? markRead([notice.id]) : markUnread(notice.id)
                                    }
                                  >
                                    {isUnread ? 'Mark read' : 'Mark unread'}
                                  </Button>
                                  {notice.onDismiss && (
                                    <Button size="sm" variant="ghost" onClick={notice.onDismiss}>
                                      Dismiss
                                    </Button>
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
                              <button
                                type="button"
                                onClick={() => activate(() => openCompanionTask(run))}
                              >
                                <span>
                                  {runTitle(run)}
                                  <small>
                                    {run.projectName} ·{' '}
                                    {run.prompts?.some((prompt) => prompt.status === 'pending')
                                      ? 'Waiting for your answer'
                                      : statusLabel[run.status]}
                                  </small>
                                </span>
                                <ExternalLinkIcon size={16} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                  </div>
                  <div className="companion-shortcuts">
                    <button type="button" onClick={() => activate(onSearch)}>
                      <SearchIcon size={16} /> Find anything
                    </button>
                    <button type="button" onClick={() => activate(onSettings)}>
                      <Settings2 size={16} /> Preferences
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
