import { Badge } from '@jackalope/ui';
import { ArrowRight, CalendarClock, MessageCircleQuestion } from 'lucide-react';
import { getAgentMetadata } from '../../lib/agent-catalog';
import { navigateWorkspace } from '../../lib/app-events';
import type { LiveEntry } from '../../lib/live-work';
import { openWork } from '../../lib/work-selection';
import { compactElapsed } from '../../lib/work-signals';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useBotStore } from '../../stores/botStore';
import type { Project } from '../../stores/projectStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { AgentStack } from '../agents/AgentAvatar';
import { ProjectMark } from '../projects/ProjectMark';
import './overview.css';

const KIND_LABEL: Record<LiveEntry['kind'], string> = {
  task: 'Task',
  conversation: 'Conversation',
  planned: 'Planned task',
  bot: 'Bot',
  review: 'Agent review',
};

/** Opens running work where it lives: bots on the Bots page, everything else in Work. */
function openLiveEntry(entry: LiveEntry) {
  if (entry.session?.persona) {
    useBotStore.getState().openConversation(entry.session.id, entry.session.persona.botId);
    navigateWorkspace('bots');
    return;
  }
  if (!entry.item) return;
  openWork(entry.item);
  // An agent review reports in the reviewed task's review panel.
  if (entry.kind === 'review' && entry.item.run && !entry.item.session && !entry.item.managed)
    useWorkViewStore.getState().open(entry.item.run.id, 'changes');
  navigateWorkspace('kanban');
}

function useAgentLabel() {
  const custom = useAgentConfigStore((state) => state.customAgents);
  return (agents: string[]) =>
    agents.map((id) => custom.find((agent) => agent.id === id)?.name ?? agentName(id)).join(', ') ||
    'Choosing an agent';
}

const agentName = (id: string) => getAgentMetadata(id)?.name ?? id;

/**
 * One running item. The compact row (Inbox) shows the project, step and elapsed time; the
 * full row (Overview) adds the kind, agent and model, and what the agent is doing now.
 */
export function LiveWorkRow({
  entry,
  project,
  now,
  compact = false,
}: {
  entry: LiveEntry;
  project?: Project;
  now: number;
  compact?: boolean;
}) {
  const agentLabel = useAgentLabel();
  const elapsed = compactElapsed(entry.since, now);
  const state = entry.waiting ? 'waiting' : 'working';
  const disabled = !entry.item && !entry.session;
  if (compact)
    return (
      <li>
        <button
          type="button"
          className="live-row"
          data-compact
          onClick={() => openLiveEntry(entry)}
          disabled={disabled}
        >
          <AgentStack agents={entry.agents} state={state} />
          <span className="live-row-text">
            <span className="live-row-title">{entry.title}</span>
            <span className="live-row-meta">
              {project && (
                <span className="live-row-project">
                  <ProjectMark project={project} />
                  <span>{project.name}</span>
                </span>
              )}
              <span className="live-row-phase">
                {entry.kind === 'review' || entry.kind === 'bot'
                  ? `${KIND_LABEL[entry.kind]} · ${entry.phase}`
                  : entry.schedule
                    ? `${entry.schedule} · ${entry.phase}`
                    : entry.phase}
              </span>
            </span>
          </span>
          <span className="live-row-end">
            {elapsed && <time dateTime={entry.since}>{elapsed}</time>}
            <ArrowRight size={14} aria-hidden="true" className="live-row-arrow" />
          </span>
        </button>
      </li>
    );
  const kind =
    entry.kind === 'planned' && entry.workers && entry.workers > 1
      ? `${KIND_LABEL.planned} · ${entry.workers} workers`
      : KIND_LABEL[entry.kind];
  return (
    <li className="live-row-item">
      <button
        type="button"
        className="live-row"
        onClick={() => openLiveEntry(entry)}
        disabled={disabled}
        data-waiting={entry.waiting || undefined}
      >
        <AgentStack agents={entry.agents} state={state} size="md" />
        <span className="live-row-text">
          <span className="live-row-title">{entry.title}</span>
          <span className="live-row-meta">
            <span>{kind}</span>
            {project && (
              <span className="live-row-project">
                <ProjectMark project={project} />
                <span>{project.name}</span>
              </span>
            )}
            <span>
              {agentLabel(entry.agents)}
              {entry.model ? ` · ${entry.model}` : ''}
            </span>
            {entry.schedule && (
              <span className="live-row-schedule">
                <CalendarClock size={12} aria-hidden="true" />
                {entry.schedule}
              </span>
            )}
          </span>
          <span className="live-row-now">
            <strong>{entry.phase}</strong>
            {entry.current && entry.current !== entry.phase ? ` · ${entry.current}` : ''}
          </span>
        </span>
        <span className="live-row-end">
          {entry.waiting ? (
            <Badge variant="warning" icon={MessageCircleQuestion}>
              Waiting on you
            </Badge>
          ) : null}
          {elapsed && (
            <time
              dateTime={entry.since}
              title={`Started ${new Date(entry.since).toLocaleString()}`}
            >
              {elapsed}
            </time>
          )}
        </span>
      </button>
    </li>
  );
}
