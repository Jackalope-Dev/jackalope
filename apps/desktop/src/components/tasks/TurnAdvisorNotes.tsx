import { Badge } from '@jackalope/ui';
import { Loader2 } from 'lucide-react';
import {
  type AdvisorNote,
  type AdvisorReview,
  type AdvisorSeverity,
  advisorNotes,
  advisorStatus,
} from '../../lib/turn-advisor';
import { ProviderMark } from '../agents/ProviderMark';
import { deciderName } from './AgentDecision';
import './turn-advisor.css';

const SEVERITY: Record<
  AdvisorSeverity,
  { label: string; variant: 'danger' | 'warning' | 'default' }
> = {
  blocker: { label: 'Blocker', variant: 'danger' },
  concern: { label: 'Concern', variant: 'warning' },
  aside: { label: 'Aside', variant: 'default' },
};

/** The turn advisor's notes on one attempt: what reached the working agent and what is only for the person. */
export function TurnAdvisorNotes({ review }: { review?: AdvisorReview | null }) {
  if (!review) return null;
  const name = review.agent ? deciderName(review.agent) : 'The advisor';
  const { sent, kept } = advisorNotes(review);
  const reviewing = review.status === 'reviewing';
  return (
    <section className="turn-advisor" aria-label="Turn advisor">
      <p className="turn-advisor-status" role={reviewing ? 'status' : undefined}>
        {reviewing ? (
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        ) : (
          review.agent && <ProviderMark provider={review.agent} size={14} />
        )}
        <span>
          <strong>Turn advisor.</strong> {advisorStatus(review, name)}
        </span>
      </p>
      {sent.length > 0 && <NoteList title="Sent to the agent" notes={sent} />}
      {kept.length > 0 && (
        <NoteList title={sent.length ? 'Only for you' : undefined} notes={kept} />
      )}
    </section>
  );
}

function NoteList({ title, notes }: { title?: string; notes: AdvisorNote[] }) {
  return (
    <div className="turn-advisor-group">
      {title && <h3 className="turn-advisor-group-title">{title}</h3>}
      <ul className="turn-advisor-notes">
        {notes.map((note) => (
          <li key={`${note.severity}:${note.text}`} className="turn-advisor-note">
            <Badge variant={SEVERITY[note.severity].variant}>{SEVERITY[note.severity].label}</Badge>
            <div className="turn-advisor-note-body">
              <p>
                {note.text}
                {note.repeated && (
                  <span className="turn-advisor-repeated"> Already sent on the previous turn.</span>
                )}
              </p>
              {note.path && <code className="turn-advisor-path">{note.path}</code>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
