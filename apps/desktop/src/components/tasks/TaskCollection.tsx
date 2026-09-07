import { Check, Columns3, Lightbulb, List, ListTodo, Search } from 'lucide-react';

import { ideaStageLabels, type WorkItem, workStages } from '../../lib/task-collection';
import type { Runner } from '../../lib/task-runtime';
import { taskNextAction } from '../../lib/task-workflow';
import { useProjectStore } from '../../stores/projectStore';
import { EmptyState } from '../ui/EmptyState';
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
}: {
  items: WorkItem[];
  runners: Runner[];
  onOpen: (item: WorkItem) => void;
  view: TaskCollectionView;
  onViewChange: (view: TaskCollectionView) => void;
}) {
  const projects = useProjectStore((state) => state.projects);
  const { filter, layout, query } = view;
  const setFilter = (filter: string) => onViewChange({ ...view, filter });
  const setLayout = (layout: 'list' | 'board') => onViewChange({ ...view, layout });
  const setQuery = (query: string) => onViewChange({ ...view, query });
  const filtered = items.filter(
    (item) =>
      (filter === 'all' || item.stage === filter) &&
      `${item.title} ${item.idea?.rawPrompt ?? ''} ${item.run?.prompt ?? ''}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const card = (item: WorkItem) => {
    const agent = item.run?.agent ?? item.idea?.assignedAgent;
    return (
      <button key={item.id} type="button" className="work-item" onClick={() => onOpen(item)}>
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
            {new Date(item.date).toLocaleDateString()}
          </span>
        </span>
        {item.run ? (
          <span className="work-item-status">
            {item.stage === 'finished' && item.run.status !== 'reviewed' ? (
              <span className="task-status">
                <Check size={16} />
                Integrated
              </span>
            ) : (
              <RunStatus status={item.run.status} />
            )}
            <span className="work-item-action">
              {item.stage === 'finished' ? 'Open result' : taskNextAction(item.run)}
            </span>
            {item.run.persistenceError && <span className="work-item-meta">Not saved</span>}
          </span>
        ) : (
          <span className="work-idea-status">
            {item.idea?.status === 'done' ? <Check size={15} /> : <Lightbulb size={15} />}
            {item.idea?.runId
              ? 'History unavailable'
              : ideaStageLabels[item.idea?.status ?? 'backlog']}
          </span>
        )}
      </button>
    );
  };
  return (
    <div className="task-collection">
      <div className="work-toolbar">
        <fieldset className="task-filter-group" aria-label="Filter tasks">
          {[{ id: 'all', label: 'All' }, ...workStages].map((stage) => (
            <button
              key={stage.id}
              type="button"
              aria-pressed={filter === stage.id}
              onClick={() => setFilter(stage.id)}
            >
              {stage.label}
              <span>
                {stage.id === 'all'
                  ? items.length
                  : items.filter((item) => item.stage === stage.id).length}
              </span>
            </button>
          ))}
        </fieldset>
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
      {items.length > 0 && (
        <label className="work-search">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="Search tasks"
            placeholder="Find a task or idea…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}
      {!filtered.length ? (
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
        <div className="work-list">{filtered.map(card)}</div>
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
