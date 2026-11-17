import { Disclosure, DisclosureBody, DisclosureSummary } from '@jackalope/ui';
import { getAgentMetadata } from '../../lib/agent-catalog';
import { ProviderMark } from '../agents/ProviderMark';
import './agent-decision.css';

/** The agent's product name, for copy about a decision it made. */
export function deciderName(agent: string) {
  return getAgentMetadata(agent)?.name ?? agent;
}

/** Marks something an agent decided for the person, with its provider and confidence. */
export function AgentDecisionChip({ agent, confidence }: { agent: string; confidence?: number }) {
  return (
    <span className="agent-decision-chip">
      <ProviderMark provider={agent} size={14} />
      <span>Decided by {deciderName(agent)}</span>
      {confidence !== undefined && (
        <span className="agent-decision-confidence">{Math.round(confidence * 100)}% sure</span>
      )}
    </span>
  );
}

/** Why the agent decided as it did; optional detail behind a disclosure. */
export function AgentDecisionReason({
  agent,
  rationale,
  evidence = [],
}: {
  agent: string;
  rationale: string;
  evidence?: string[];
}) {
  if (!rationale && !evidence.length) return null;
  return (
    <Disclosure className="agent-decision-reason">
      <DisclosureSummary>Why {deciderName(agent)} decided this</DisclosureSummary>
      <DisclosureBody>
        {rationale && <p>{rationale}</p>}
        {evidence.length > 0 && (
          <ul className="agent-decision-evidence">
            {evidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </DisclosureBody>
    </Disclosure>
  );
}

const escalationLabels: Record<string, string> = {
  secret: 'Secret',
  payment: 'Payment',
  sign_in: 'Sign-in',
  account: 'Account',
  publish: 'Publishing',
  protected_path: 'Protected path',
  direction: 'Direction',
  destructive: 'Destructive',
  unclear: 'Unclear',
  decider: 'Agent unsure',
  limit: 'Limit reached',
  policy: 'Policy',
  checks: 'Checks',
  interrupted: 'Interrupted',
};

/** The short label for why something reached the person instead of an agent. */
function escalationLabel(category: string) {
  return escalationLabels[category] ?? category;
}

/** Says why a question came to the person although agents may decide. */
export function EscalationNote({ category, reason }: { category: string; reason: string }) {
  return (
    <p className="agent-decision-escalation">
      <strong>Sent to you · {escalationLabel(category)}.</strong> {reason}
    </p>
  );
}
