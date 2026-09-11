import { Badge, Checkbox, Disclosure, DisclosureSummary, SearchField } from '@jackalope/ui';
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronRight,
  Columns3,
  Lightbulb,
  List,
  ListTodo,
} from 'lucide-react';
import { memo, type ReactNode, useMemo, useRef, useState } from 'react';

import { ideaStageLabels, type WorkItem, workStages } from '../../lib/task-collection';
import type { Runner } from '../../lib/task-runtime';
import { taskNextAction } from '../../lib/task-workflow';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import { RunStatus } from './RunStatus';
import './task-collection.css';

export interface TaskCollectionView {
  filter: string;
  layout: 'list' | 'board';
  query: string;
}

export function TaskCollection({
  items,
  runners,
  onOpen,
  view,
  onViewChange,
  scope,
  emptyState,
  archived = false,
  onArchive,
  onBusyChange,
}: {
  items: WorkItem[];
  runners: Runner[];
  onOpen: (item: WorkItem) => void;
  view: TaskCollectionView;
  onViewChange: (view: TaskCollectionView) => void;
  scope?: ReactNode;
  emptyState?: ReactNode;
  archived?: boolean;
  onArchive?: (items: WorkItem[], archived: boolean) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [undo, setUndo] = useState<WorkItem[]>([]);
  const actionFocus = useRef<HTMLButtonElement>(null);
  const projects = useProjectStore((state) => state.projects);
  const { filter, layout, query } = view;
  const setFilter = (filter: string) => onViewChange({ ...view, filter });
  const setLayout = (layout: 'list' | 'board') => onViewChange({ ...view, layout });
  const setQuery = (query: string) => onViewChange({ ...view, query });
  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (filter === 'all' || item.stage === filter) &&
          `${item.title} ${item.idea?.rawPrompt ?? ''} ${item.run?.prompt ?? ''}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [items, filter, query],
  );
  const eligible = filtered.filter((item) => archived || !item.archiveBlocked);
  const selected = eligible.filter((item) => selection.includes(item.id));
  const finished = eligible.filter((item) => item.stage === 'finished');
  const changeArchive = async (targets: WorkItem[], archive: boolean) => {
    if (!onArchive || pending.current || !targets.length) return;
    pending.current = true;
    setBusy(true);
    onBusyChange?.(true);
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
      setError(String(cause));
    } finally {
      pending.current = false;
      setBusy(false);
      onBusyChange?.(false);
      requestAnimationFrame(() => actionFocus.current?.focus());
    }
  };
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
        runners={runners}
        projects={projects}
        onOpen={onOpen}
        layout={layout}
        disabled={busy}
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
      {items.length > 0 && !archived && (
        <fieldset className="work-priorities" aria-label="Focus your work">
          {workStages
            .filter((stage) => stage.id !== 'finished')
            .map((stage) => {
              const count = items.filter((item) => item.stage === stage.id).length;
              return (
                <button
                  key={stage.id}
                  type="button"
                  aria-pressed={filter === stage.id}
                  onClick={() => setFilter(filter === stage.id ? 'all' : stage.id)}
                >
                  <strong>{count}</strong>
                  <span>{stage.label}</span>
                </button>
              );
            })}
        </fieldset>
      )}
      <div className="work-toolbar">
        {scope}
        <SearchField
          aria-label="Search tasks"
          placeholder="Find a task…"
          value={query}
          onValueChange={(value) => setQuery(value)}
          containerClassName="work-search"
        />
        <Select aria-label="Filter tasks by status" value={filter} onValueChange={setFilter}>
          <SelectItem value="all">All statuses</SelectItem>
          {workStages.map((stage) => (
            <SelectItem key={stage.id} value={stage.id}>
              {stage.label} · {items.filter((item) => item.stage === stage.id).length}
            </SelectItem>
          ))}
        </Select>
        <fieldset className="work-layout" aria-label="Task view">
          <button type="button" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}>
            <List size={16} />
            List
          </button>
          <button
            type="button"
            aria-pressed={layout === 'board'}
            onClick={() => setLayout('board')}
          >
            <Columns3 size={16} />
            Board
          </button>
        </fieldset>
      </div>
      {onArchive && (
        <>
          <div className="work-toolbar work-cleanup">
            <Button
              ref={actionFocus}
              variant="outline"
              disabled={busy}
              aria-pressed={selecting}
              onClick={() => {
                setSelecting(!selecting);
                setSelection([]);
              }}
            >
              {selecting ? 'Done selecting' : 'Select tasks'}
            </Button>
            {selecting ? (
              <>
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
              </>
            ) : !archived && finished.length > 0 ? (
              <Button
                variant="outline"
                disabled={busy}
                loading={busy}
                loadingLabel="Archiving…"
                onClick={() => void changeArchive(finished, true)}
              >
                <Archive size={16} /> Archive finished ({finished.length})
              </Button>
            ) : null}
          </div>
          <p className="task-muted work-archive-help">
            {archived
              ? 'Restore a task to bring it back to your current tasks.'
              : 'Archived tasks can be restored. Results and workspaces are kept.'}
          </p>
        </>
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
        emptyState
      ) : !filtered.length ? (
        <EmptyState
          icon={ListTodo}
          title={items.length ? 'No matching tasks' : 'Room for your next idea'}
          description={
            items.length
              ? 'Try another stage or search.'
              : 'Start a task now, or save an idea for later. Its work and review stay here.'
          }
        />
      ) : layout === 'list' ? (
        <div className="work-list">
          {workStages.map((stage) => {
            const stageItems = filtered.filter((item) => item.stage === stage.id);
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
              <Disclosure key={stage.id} className="work-group work-finished">
                <DisclosureSummary>{heading}</DisclosureSummary>
                {stageItems.map(card)}
              </Disclosure>
            ) : (
              <section key={stage.id} className="work-group" aria-label={stage.label}>
                <h2>{heading}</h2>
                {stageItems.map(card)}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="work-board">
          {workStages
            .filter((stage) => filter === 'all' || filter === stage.id)
            .map((stage) => {
              const stageItems = filtered.filter((item) => item.stage === stage.id);
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
const WorkCard = memo(
  function WorkCard({
    item,
    runners,
    projects,
    onOpen,
    layout,
    disabled,
  }: {
    item: WorkItem;
    runners: Runner[];
    projects: ReturnType<typeof useProjectStore.getState>['projects'];
    onOpen: (item: WorkItem) => void;
    layout: TaskCollectionView['layout'];
    disabled: boolean;
  }) {
    const agent = item.run?.agent ?? item.idea?.assignedAgent;
    const date = new Date(item.date);
    return (
      <button
        id={`work-item-${item.id}`}
        key={item.id}
        type="button"
        disabled={disabled}
        className="work-item"
        onClick={() => onOpen(item)}
      >
        <span className="work-item-content">
          <span className="work-item-title">{item.title}</span>
          <span className="work-item-meta">
            <span>
              {item.run?.projectName ??
                projects.find((p) => p.id === item.idea?.projectId)?.name ??
                'No project yet'}{' '}
              ·{' '}
            </span>
            {agent && agent !== 'Unassigned' && (
              <span>{runners.find((r) => r.id === agent)?.name ?? agent} · </span>
            )}
            {Number.isNaN(date.getTime()) ? (
              'Date unavailable'
            ) : (
              <time dateTime={item.date} title={dateTimeFormatter.format(date)}>
                {dateFormatter.format(date)}
              </time>
            )}
          </span>
        </span>
        {item.run ? (
          <span className="work-item-status">
            {item.stage === 'finished' && item.run.status !== 'reviewed' ? (
              <Badge appearance="plain" className="task-status">
                <Check size={16} />
                Integrated
              </Badge>
            ) : layout === 'board' ||
              (item.stage === 'attention' &&
                ['failed', 'stopped', 'interrupted'].includes(item.run.status)) ? (
              <RunStatus status={item.run.status} />
            ) : null}
            <span className="work-item-action">
              {item.stage === 'finished' ? 'Open result' : taskNextAction(item.run)}
              <ChevronRight size={14} aria-hidden="true" />
            </span>
            {item.run.persistenceError && <span className="work-item-meta">Not saved</span>}
          </span>
        ) : (
          <Badge appearance="plain" className="work-idea-status">
            {item.idea?.status === 'done' ? <Check size={15} /> : <Lightbulb size={15} />}
            {item.idea?.runId
              ? 'History unavailable'
              : ideaStageLabels[item.idea?.status ?? 'backlog']}
          </Badge>
        )}
      </button>
    );
  },
  (before, after) =>
    before.onOpen === after.onOpen &&
    before.layout === after.layout &&
    before.disabled === after.disabled &&
    before.runners === after.runners &&
    before.projects === after.projects &&
    before.item.id === after.item.id &&
    before.item.title === after.item.title &&
    before.item.stage === after.item.stage &&
    before.item.date === after.item.date &&
    before.item.run === after.item.run &&
    before.item.idea === after.item.idea,
);
