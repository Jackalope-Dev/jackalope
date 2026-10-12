import { ArrowRight } from 'lucide-react';
import { matchesWorkFilter, type WorkItem, workPresence } from '../../lib/task-collection';
import { attentionQueue, type WorkspacePreset } from '../../lib/workbench';
import { useChangeStats } from '../../stores/workSignalsStore';
import { AgentStack } from '../agents/AgentAvatar';
import { Button } from '../ui/button';
import { NoticeRow } from '../ui/NoticeRow';
import { isUnread, useOpenSignalKey, useWorkSignals, WorkSignals } from './WorkSignals';
import './workspace-modes.css';

export function WorkspaceModeHome({
  preset,
  items,
  filter,
  onOpen,
  onFilter,
}: {
  preset: WorkspacePreset;
  items: WorkItem[];
  filter: string;
  onOpen: (item: WorkItem) => void;
  onFilter: (filter: string) => void;
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
          <NoticeRow onClick={() => onFilter('attention')}>
            {attention.length - 1} more {attention.length === 2 ? 'needs' : 'need'} your attention
          </NoticeRow>
        )}
      </section>
    ) : null;
  }
  // Build keeps its work list in the sidebar; project tools live under Project.
  if (preset === 'build') return null;
  // Counts only help once there is work to filter; an empty project shows its empty state.
  if (!items.length) return null;
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
            title={detail}
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
            {!attention.length && <p>New questions, blockers and reviews will appear here.</p>}
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
  const signals = useWorkSignals();
  const openKey = useOpenSignalKey();
  const stats = useChangeStats([item.run]);
  const unread = isUnread(item, signals, openKey);
  return (
    <button type="button" className="mode-work-item" onClick={() => onOpen(item)}>
      <AgentStack agents={presence.agents} state={presence.state} size="sm" />
      <span className="mode-work-copy">
        <strong>{item.title}</strong>
        <small>{item.run?.progress?.label || item.statusLabel || presence.action}</small>
      </span>
      <WorkSignals
        item={item}
        unread={unread}
        stats={item.run ? stats[item.run.id]?.value : undefined}
      />
      <ArrowRight size={16} />
    </button>
  );
}
