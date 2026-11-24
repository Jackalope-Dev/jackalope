import { useId, useState } from 'react';
import type { ExternalSession } from '../../lib/external-sessions';
import { ProviderMark } from '../agents/ProviderMark';

/** Rows a project shows before "Show more". */
const COLLAPSED = 3;
/** The most a project lists; older ones stay in their CLI. */
const EXPANDED = 25;

/** A project's conversations from outside Jackalope: a quiet, read-only group under its work. */
export function ExternalSessionRows({
  sessions,
  selectedKey,
  onOpen,
}: {
  sessions: ExternalSession[];
  selectedKey: string | null;
  onOpen: (session: ExternalSession) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const headingId = useId();
  if (!sessions.length) return null;
  const shown = sessions.slice(0, expanded ? EXPANDED : COLLAPSED);
  const more = Math.min(sessions.length, EXPANDED) - shown.length;
  return (
    <div className="external-sessions">
      <p id={headingId} className="external-sessions-heading">
        Outside Jackalope
      </p>
      <ul className="project-tree-items" aria-labelledby={headingId}>
        {shown.map((session) => (
          <li key={session.key} className="work-sidebar-row">
            <button
              type="button"
              className="work-sidebar-item external-session-item"
              aria-current={session.key === selectedKey ? 'page' : undefined}
              title={[session.title, session.agentName, session.branch].filter(Boolean).join('\n')}
              onClick={() => onOpen(session)}
            >
              <ProviderMark provider={session.agent} size={14} />
              <span className="work-sidebar-title">
                {session.title}
                <span className="sr-only">, {session.agentName}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {(more > 0 || expanded) && sessions.length > COLLAPSED && (
        <button
          type="button"
          className="external-sessions-more"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show fewer' : `Show ${more} more`}
        </button>
      )}
    </div>
  );
}
