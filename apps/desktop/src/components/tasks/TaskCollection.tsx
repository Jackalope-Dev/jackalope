import {
  Button,
  Checkbox,
  Disclosure,
  DisclosureSummary,
  EmptyState,
  InlineNotice,
  DropdownMenu as Menu,
  SearchField,
  SegmentedControl,
  Select,
  SelectItem,
} from '@jackalope/ui';
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Columns3,
  Lightbulb,
  List,
  ListChecks,
  ListTodo,
  MoreHorizontal,
  Radio,
} from 'lucide-react';
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { projectNameHints } from '../../lib/project-name-hints';
import {
  matchesWorkFilter,
  needsYou,
  OPEN_SECTION_LIMIT,
  type WorkItem,
  workGroup,
  workGroups,
  workPresence,
  workRowStatus,
  workShape,
} from '../../lib/task-collection';
import { workProjectId } from '../../lib/work-selection';
import { type Project, useProjectStore } from '../../stores/projectStore';
import { useChangeStats } from '../../stores/workSignalsStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { AgentStack } from '../agents/AgentAvatar';
import { useProjectWork } from '../layout/WorkSidebar';
import { ProjectMark } from '../projects/ProjectMark';
import { isUnread, useOpenSignalKey, useWorkSignals, WorkSignals } from './WorkSignals';
import './task-collection.css';
import { describeError } from '@jackalope/contracts/errors';
import type { ChangeStats } from '../../lib/run-types';

export interface TaskCollectionView {
  filter: string;
  layout: 'list' | 'board';
  query: string;
}

export function TaskCollection({
  items,
  onOpen,
  view,
  onViewChange,
  scope,
  menuItems,
  emptyState,
  archived = false,
  onArchivedChange,
  onArchive,
}: {
  items: WorkItem[];
  onOpen: (item: WorkItem) => void;
  view: TaskCollectionView;
  onViewChange: (view: TaskCollectionView) => void;
  scope?: ReactNode;
  /** The page's own commands, listed first in the toolbar's work menu. */
  menuItems?: ReactNode;
  emptyState?: ReactNode;
  archived?: boolean;
  /** Switches between current and archived work from the organize menu. */
  onArchivedChange?: (archived: boolean) => void;
  onArchive?: (items: WorkItem[], archived: boolean) => Promise<void>;
}) {
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [undo, setUndo] = useState<WorkItem[]>([]);
  const actionFocus = useRef<HTMLButtonElement>(null);
  const [focusReturn, setFocusReturn] = useState(0);
  useEffect(() => {
    if (focusReturn) actionFocus.current?.focus();
  }, [focusReturn]);
  const { layout, query } = view;
  const filter = workGroup(view.filter);
  const setFilter = (filter: string) => onViewChange({ ...view, filter });
  const setLayout = (layout: 'list' | 'board') => onViewChange({ ...view, layout });
  const setQuery = (query: string) => onViewChange({ ...view, query });
  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          matchesWorkFilter(item, filter) &&
          `${item.title} ${item.idea?.rawPrompt ?? ''} ${item.run?.prompt ?? ''}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [items, filter, query],
  );
  const eligible = filtered.filter((item) => archived || !item.archiveBlocked);
  const selected = eligible.filter((item) => selection.includes(item.id));
  const finished = eligible.filter((item) => item.stage === 'finished');
  const canArchiveFinished = !!onArchive && !archived && finished.length > 0;
  const hasOrganizeItems = (!!onArchive && !selecting) || canArchiveFinished;
  const changeArchive = async (targets: WorkItem[], archive: boolean) => {
    if (!onArchive || pending.current || !targets.length) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setUndo([]);
    try {
      await onArchive(targets, archive);
      setSelection([]);
      setNotice(
        `${targets.length} ${targets.length === 1 ? 'task' : 'tasks'} ${archive ? 'archived' : 'restored'}.`,
      );
      if (archive) setUndo(targets);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      pending.current = false;
      setBusy(false);
      setFocusReturn((value) => value + 1);
    }
  };
  const signals = useWorkSignals();
  const openKey = useOpenSignalKey();
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const workScope = useWorkViewStore((state) => state.scope);
  const projectWork = useProjectWork();
  // Counted from the same work as the sidebar's Work badge, so the two always agree.
  const elsewhere =
    workScope === 'project' && activeProjectId && !archived
      ? [...projectWork]
          .filter(([projectId]) => projectId !== activeProjectId)
          .flatMap(([, work]) => work)
          .filter(needsYou).length
      : 0;
  const elsewhereLine = elsewhere > 0 && (
    <p className="work-elsewhere">
      {elsewhere} more {elsewhere === 1 ? 'needs' : 'need'} you in other projects ·{' '}
      <button
        type="button"
        className="work-elsewhere-action"
        onClick={() => useWorkViewStore.getState().setScope('all')}
      >
        Show all
      </button>
    </p>
  );
  // Small sections open by default; a toggle the person makes holds until the page reloads.
  const [finishedChoice, setFinishedChoice] = useState<boolean | null>(null);
  // Rows name their project only when the list spans more than one.
  const rowProjects = useMemo(() => {
    const ids = new Set(items.map(workProjectId).filter(Boolean));
    if (ids.size < 2) return new Map<string, RowProject>();
    const hints = projectNameHints(projects);
    return new Map(
      projects.map((project) => [project.id, { project, hint: hints.get(project.id) }]),
    );
  }, [items, projects]);
  // Bounded so a long history does not trigger many Git reads at once.
  const stats = useChangeStats(archived ? [] : filtered.slice(0, 60).map((item) => item.run));
  const card = (item: WorkItem) => (
    <div key={item.id} className="work-item-row">
      {selecting && (
        <label className="work-select" title={!archived ? item.archiveBlocked : undefined}>
          <Checkbox
            aria-label={`Select ${item.title}`}
            disabled={busy || (!archived && !!item.archiveBlocked)}
            checked={selected.some((selected) => selected.id === item.id)}
            onChange={(event) =>
              setSelection((ids) =>
                event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id),
              )
            }
          />
        </label>
      )}
      <WorkCard
        item={item}
        onOpen={onOpen}
        disabled={busy}
        unread={isUnread(item, signals, openKey)}
        stats={item.run ? stats[item.run.id]?.value : undefined}
        project={rowProjects.get(workProjectId(item) ?? '')}
      />
      {onArchive && !selecting && (
        <Button
          variant="ghost"
          className="work-archive"
          disabled={busy || (!archived && !!item.archiveBlocked)}
          aria-label={`${archived ? 'Restore' : 'Archive'} ${item.title}`}
          title={
            !archived && item.archiveBlocked
              ? item.archiveBlocked
              : archived
                ? 'Restore task'
                : 'Archive task'
          }
          onClick={() => void changeArchive([item], !archived)}
        >
          {archived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
        </Button>
      )}
    </div>
  );

  return (
    <div className="task-collection">
      <div className="work-toolbar">
        {scope}
        <SearchField
          aria-label="Search tasks"
          placeholder="Find a task…"
          value={query}
          onValueChange={(value) => setQuery(value)}
          containerClassName="work-search"
        />
        <Select
          aria-label="Filter tasks by status"
          value={archived ? ARCHIVED_FILTER : filter}
          onValueChange={(value) => {
            if (value === ARCHIVED_FILTER) return onArchivedChange?.(true);
            if (archived) onArchivedChange?.(false);
            setFilter(value);
          }}
        >
          <SelectItem value="all">All statuses</SelectItem>
          {!archived &&
            workGroups.map((stage) => (
              <SelectItem key={stage.id} value={stage.id}>
                {stage.label} · {items.filter((item) => matchesWorkFilter(item, stage.id)).length}
              </SelectItem>
            ))}
          {onArchivedChange && <SelectItem value={ARCHIVED_FILTER}>Archived</SelectItem>}
        </Select>
        <SegmentedControl
          className="work-layout"
          label="Task view"
          value={layout}
          onChange={setLayout}
          items={[
            {
              id: 'list',
              label: (
                <>
                  <List size={16} aria-hidden="true" />
                  List
                </>
              ),
            },
            {
              id: 'board',
              label: (
                <>
                  <Columns3 size={16} aria-hidden="true" />
                  Board
                </>
              ),
            },
          ]}
        />
        {(menuItems || hasOrganizeItems) && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button ref={actionFocus} variant="ghost" aria-label="Work actions">
                <MoreHorizontal size={18} />
              </Button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content className="workspace-menu" align="end" sideOffset={8}>
                {menuItems}
                {menuItems && hasOrganizeItems && <Menu.Separator className="menu-separator" />}
                {onArchive && !selecting && (
                  <Menu.Item
                    className="workspace-menu-item"
                    disabled={busy}
                    onSelect={() => {
                      setSelecting(true);
                      setSelection([]);
                    }}
                  >
                    <ListChecks size={16} />
                    Select tasks
                  </Menu.Item>
                )}
                {canArchiveFinished && (
                  <Menu.Item
                    className="workspace-menu-item"
                    disabled={busy}
                    onSelect={() => void changeArchive(finished, true)}
                  >
                    <Archive size={16} />
                    Archive finished ({finished.length})
                  </Menu.Item>
                )}
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        )}
      </div>
      {archived && onArchivedChange && (
        <div className="work-filter-summary">
          <p>Archived work</p>
          <Button variant="ghost" disabled={busy} onClick={() => onArchivedChange(false)}>
            Show current work
          </Button>
        </div>
      )}
      {onArchive && selecting && (
        <div className="work-toolbar work-cleanup">
          <label className="work-select-all">
            <Checkbox
              aria-label="Select all matching tasks"
              disabled={busy || !eligible.length}
              checked={!!eligible.length && selected.length === eligible.length}
              indeterminate={selected.length > 0 && selected.length < eligible.length}
              onChange={(event) =>
                setSelection(event.target.checked ? eligible.map((item) => item.id) : [])
              }
            />
            Select all matching
          </label>
          <Button
            variant="outline"
            disabled={!selected.length || busy}
            loading={busy}
            loadingLabel={archived ? 'Restoring…' : 'Archiving…'}
            onClick={() => void changeArchive(selected, !archived)}
          >
            {archived ? 'Restore' : 'Archive'} selected ({selected.length})
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setSelecting(false);
              setSelection([]);
            }}
          >
            Done
          </Button>
        </div>
      )}
      {error && <InlineNotice tone="error">Some tasks could not be updated. {error}</InlineNotice>}
      {notice && (
        <div className="work-filter-summary">
          <p role="status">{notice}</p>
          {undo.length > 0 && (
            <Button variant="ghost" disabled={busy} onClick={() => void changeArchive(undo, false)}>
              Undo
            </Button>
          )}
        </div>
      )}
      {(query.trim() || filter !== 'all') && (
        <div className="work-filter-summary">
          <p role="status">
            {filtered.length} matching {filtered.length === 1 ? 'task' : 'tasks'}
          </p>
          <Button
            variant="ghost"
            onClick={() => onViewChange({ ...view, filter: 'all', query: '' })}
          >
            Clear filters
          </Button>
        </div>
      )}
      {!items.length && emptyState ? (
        <>
          {emptyState}
          {elsewhereLine}
        </>
      ) : !filtered.length ? (
        <>
          <EmptyState
            icon={ListTodo}
            title={items.length ? 'No matching tasks' : 'Room for your next task'}
            description={
              items.length
                ? 'Try another stage or search.'
                : 'Start a task now, or save a draft for later. Its work and review stay here.'
            }
          />
          {elsewhereLine}
        </>
      ) : layout === 'list' ? (
        <fieldset
          className="work-list"
          aria-label="Work items"
          onKeyDown={(event) => {
            if (
              !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) ||
              !(event.target instanceof HTMLElement) ||
              !event.target.classList.contains('work-item')
            )
              return;
            const rows = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('.work-item:not(:disabled)'),
            ).filter((row) => row.getClientRects().length);
            const index = rows.indexOf(event.target as HTMLButtonElement);
            if (index < 0) return;
            event.preventDefault();
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? rows.length - 1
                  : Math.max(
                      0,
                      Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                    );
            rows[next]?.focus();
          }}
        >
          {!filtered.some((item) => matchesWorkFilter(item, 'attention')) && elsewhereLine}
          {workGroups.map((stage) => {
            const stageItems = filtered.filter((item) => matchesWorkFilter(item, stage.id));
            if (!stageItems.length) return null;
            const heading = (
              <>
                {stage.label} <span>{stageItems.length}</span>
              </>
            );
            return stage.id === 'finished' &&
              filter === 'all' &&
              !query.trim() &&
              !selecting &&
              !archived ? (
              <Disclosure
                key={stage.id}
                className="work-group work-finished"
                open={finishedChoice ?? stageItems.length <= OPEN_SECTION_LIMIT}
                onToggle={(event) => {
                  const open = event.currentTarget.open;
                  // React setting `open` also fires toggle; only a change away from it is a choice.
                  if (open !== (finishedChoice ?? stageItems.length <= OPEN_SECTION_LIMIT))
                    setFinishedChoice(open);
                }}
              >
                <DisclosureSummary>{heading}</DisclosureSummary>
                {stageItems.map(card)}
              </Disclosure>
            ) : (
              <section key={stage.id} className="work-group" aria-label={stage.label}>
                <h2>{heading}</h2>
                {stage.id === 'attention' ? (
                  <>
                    {needsYouRows(stageItems, card)}
                    {elsewhereLine}
                  </>
                ) : (
                  stageItems.map(card)
                )}
              </section>
            );
          })}
        </fieldset>
      ) : (
        <>
          {elsewhereLine}
          <div className="work-board">
            {workGroups
              .filter((stage) => filter === 'all' || filter === stage.id)
              .map((stage) => {
                const stageItems = filtered.filter((item) => matchesWorkFilter(item, stage.id));
                return (
                  <section key={stage.id} className="work-column" aria-label={stage.label}>
                    <h2>
                      {stage.label}
                      <span>{stageItems.length}</span>
                    </h2>
                    {stageItems.length ? (
                      stageItems.map(card)
                    ) : (
                      <p className="work-column-empty">Nothing here yet</p>
                    )}
                  </section>
                );
              })}
          </div>
        </>
      )}
    </div>
  );
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'short',
  timeStyle: 'medium',
});
const OLDER_MS = 7 * 24 * 60 * 60 * 1000;
/** The status filter's entry for the archived view, which the parent owns. */
const ARCHIVED_FILTER = 'archived';

/** Needs-you rows, with ones untouched for a week under a quiet "Older" subheading. */
function needsYouRows(items: WorkItem[], card: (item: WorkItem) => ReactNode) {
  const cutoff = Date.now() - OLDER_MS;
  const older = items
    .filter((item) => Date.parse(item.date) < cutoff)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  if (!older.length || older.length === items.length) return items.map(card);
  return (
    <>
      {items.filter((item) => !older.includes(item)).map(card)}
      <h3 className="work-subgroup">Older</h3>
      {older.map(card)}
    </>
  );
}

interface RowProject {
  project: Project;
  hint?: string;
}

/** The row's next step, always a verb; why it needs you reads in the meta line. */
function workRowAction(item: WorkItem, action: string) {
  if (!item.run && !item.session && !item.managed && item.idea?.runId) return 'History unavailable';
  return action;
}

const WorkCard = memo(
  function WorkCard({
    item,
    onOpen,
    disabled,
    unread,
    stats,
    project,
  }: {
    unread: boolean;
    stats?: ChangeStats;
    project?: RowProject;
    item: WorkItem;
    onOpen: (item: WorkItem) => void;
    disabled: boolean;
  }) {
    const presence = workPresence(item);
    const date = new Date(item.date);
    const action = workRowAction(item, presence.action);
    const status = workRowStatus(item, action);
    return (
      <button
        id={`work-item-${item.id}`}
        key={item.id}
        type="button"
        disabled={disabled}
        className="work-item"
        data-unread={unread || undefined}
        title={item.title}
        onClick={() => onOpen(item)}
      >
        {presence.agents.length ? (
          <AgentStack agents={presence.agents} state={presence.state} />
        ) : (
          <span className="work-avatar-fallback" aria-hidden="true">
            {item.session ? <Radio size={16} /> : <Lightbulb size={16} />}
          </span>
        )}
        <span className="work-item-content">
          <span className="work-item-title">{item.title}</span>
          <span className="work-item-meta">
            <span className="work-item-meta-text">
              {project && (
                <>
                  <span className="work-item-project">
                    <ProjectMark project={project.project} />
                    {project.project.name}
                    {project.hint && (
                      <span className="work-item-project-hint"> {project.hint}</span>
                    )}
                  </span>
                  {' · '}
                </>
              )}
              {workShape(item)}
              {status && ` · ${status}`}
              {!Number.isNaN(date.getTime()) && (
                <>
                  {' · '}
                  <time dateTime={item.date} title={dateTimeFormatter.format(date)}>
                    {dateFormatter.format(date)}
                  </time>
                </>
              )}
            </span>
            <WorkSignals item={item} unread={unread} stats={stats} />
          </span>
        </span>
        <span className="work-item-action">
          {action}
          <ChevronRight size={14} aria-hidden="true" />
        </span>
      </button>
    );
  },
  (before, after) =>
    before.onOpen === after.onOpen &&
    before.disabled === after.disabled &&
    before.unread === after.unread &&
    before.stats === after.stats &&
    before.project === after.project &&
    before.item.id === after.item.id &&
    before.item.title === after.item.title &&
    before.item.stage === after.item.stage &&
    before.item.statusLabel === after.item.statusLabel &&
    before.item.date === after.item.date &&
    before.item.run === after.item.run &&
    before.item.session === after.item.session &&
    before.item.managed === after.item.managed &&
    before.item.idea === after.item.idea,
);
