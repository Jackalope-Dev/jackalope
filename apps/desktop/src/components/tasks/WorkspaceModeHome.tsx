import {
  ArrowRight,
  BookOpen,
  GitBranch,
  GitCommitHorizontal,
  ListTodo,
  Workflow,
} from 'lucide-react';
import { matchesWorkFilter, type WorkItem, workPresence } from '../../lib/task-collection';
import { attentionQueue, type WorkspacePreset } from '../../lib/workbench';
import { AgentStack } from '../agents/AgentAvatar';
import { navigateWorkspace } from '../layout/navigation';
import { Button } from '../ui/button';
import './workspace-modes.css';

export function WorkspaceModeHome({
  preset,
  items,
  filter,
  onOpen,
  onFilter,
  onPlan,
}: {
  preset: WorkspacePreset;
  items: WorkItem[];
  filter: string;
  onOpen: (item: WorkItem) => void;
  onFilter: (filter: string) => void;
  onPlan: () => void;
}) {
  const attention = attentionQueue(items);
  if (preset === 'focus') {
    const next =
      attention[0] ??
      [...items]
        .filter((item) => item.stage !== 'finished' && (item.run || item.session || item.managed))
        .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
    return next ? (
      <section className="focus-resume" aria-label="Pick up one task">
        <div className="mode-section-heading">
          <h2>{attention.length ? 'Your next decision' : 'Pick up where you left off'}</h2>
        </div>
        <ModeWorkItem item={next} onOpen={onOpen} />
        {attention.length > 1 && (
          <button type="button" className="task-inline-link" onClick={() => onFilter('attention')}>
            {attention.length - 1} more {attention.length === 2 ? 'needs' : 'need'} your attention
          </button>
        )}
      </section>
    ) : null;
  }
  if (preset === 'build')
    return (
      <nav className="build-tool-shelf" aria-label="Build tools">
        {[
          {
            label: 'Project context',
            detail: 'Guidance and saved lessons',
            icon: BookOpen,
            view: 'project-knowledge',
          },
          {
            label: 'Changes',
            detail: 'Review and commit work',
            icon: GitCommitHorizontal,
            view: 'changes',
          },
          {
            label: 'Worktrees',
            detail: 'Branches and local workspaces',
            icon: GitBranch,
            view: 'worktrees',
          },
          {
            label: 'Repo TODOs',
            detail: 'Find the next change',
            icon: ListTodo,
            view: 'repo-todos',
          },
        ].map(({ label, detail, icon: Icon, view }) => (
          <button
            key={view}
            type="button"
            onClick={() =>
              navigateWorkspace(
                view as 'project-knowledge' | 'changes' | 'worktrees' | 'repo-todos',
              )
            }
          >
            <Icon size={19} />
            <span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
            <ArrowRight size={14} />
          </button>
        ))}
        <button type="button" onClick={onPlan}>
          <Workflow size={19} />
          <span>
            <strong>Plan feature work</strong>
            <small>Coordinate a larger change</small>
          </span>
          <ArrowRight size={14} />
        </button>
      </nav>
    );
  return (
    <div className="oversee-summary">
      <nav className="oversee-counts" aria-label="Project activity">
        {[
          { filter: 'attention', label: 'Needs you', detail: 'Questions, blockers and reviews' },
          { filter: 'working', label: 'In progress', detail: 'Running or queued work' },
          { filter: 'ideas', label: 'Saved ideas', detail: 'Ready to shape into work' },
          { filter: 'finished', label: 'Finished', detail: 'Completed work to revisit' },
        ].map(({ filter: group, label, detail }) => (
          <button
            type="button"
            key={group}
            aria-pressed={filter === group}
            onClick={() => onFilter(group)}
          >
            <span>{label}</span>
            <strong>{items.filter((item) => matchesWorkFilter(item, group)).length}</strong>
            <small>{detail}</small>
          </button>
        ))}
      </nav>
      <section className="oversee-inbox" aria-label="Next decisions">
        <div className="mode-section-heading">
          <div>
            <h2>{attention.length ? 'Next decisions' : 'Nothing waiting on you'}</h2>
            <p>
              {attention.length
                ? 'Questions and blockers first, then the oldest reviews.'
                : 'New questions, blockers and reviews will appear here.'}
            </p>
          </div>
          {!!attention.length && (
            <Button variant="outline" onClick={() => onOpen(attention[0])}>
              Review next <ArrowRight size={16} />
            </Button>
          )}
        </div>
        {!!attention.length && (
          <div className="oversee-priorities">
            {attention.slice(0, 3).map((item) => (
              <ModeWorkItem key={item.id} item={item} onOpen={onOpen} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ModeWorkItem({ item, onOpen }: { item: WorkItem; onOpen: (item: WorkItem) => void }) {
  const presence = workPresence(item);
  return (
    <button type="button" className="mode-work-item" onClick={() => onOpen(item)}>
      <AgentStack agents={presence.agents} state={presence.state} size="sm" />
      <span className="mode-work-copy">
        <strong>{item.title}</strong>
        <small>{item.run?.progress?.label || item.statusLabel || presence.action}</small>
      </span>
      <ArrowRight size={16} />
    </button>
  );
}
