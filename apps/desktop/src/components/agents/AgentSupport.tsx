import { Check, Minus, X } from 'lucide-react';
import { agentCapabilities } from '../../lib/agent-capabilities';

type SupportState = 'yes' | 'partial' | 'no';
const icons = { yes: Check, partial: Minus, no: X };

export function AgentSupport({ adapter }: { adapter: string }) {
  const support = agentCapabilities(adapter);
  if (!support)
    return <p className="task-muted">Choose a supported adapter to see its capabilities.</p>;
  if (['gemini', 'aider', 'goose'].includes(adapter))
    return (
      <p className="task-muted mt-4">
        Separate account setup is available. Running tasks with this agent is still in development.
      </p>
    );
  // `detail` carries the nuance as a tooltip so the page stays scannable.
  const features: [string, SupportState, string][] = [
    ['Project context', 'yes', 'Project context, task awareness and messages at checkpoints.'],
    [
      'Questions & approvals',
      'yes',
      support.bridge === 'mcp'
        ? 'Questions and validation through built-in tools.'
        : 'Questions and validation through permitted shell and network tools.',
    ],
    [
      'Browser evidence',
      adapter === 'codex' ? 'partial' : 'yes',
      adapter === 'codex'
        ? 'Read tools; browser actions may require permission.'
        : 'Browser evidence and interaction, subject to CLI permissions.',
    ],
    [
      'Project connections',
      'yes',
      support.direct.length
        ? 'Selected project connections through direct and on-demand tools.'
        : 'Selected project connections through on-demand tools.',
    ],
    ['History & resume', 'yes', 'Continuation, stop and saved history.'],
    [
      'Separate accounts',
      support.accounts ? 'yes' : 'no',
      adapter === 'antigravity'
        ? 'Gemini API keys; current CLI subscription login.'
        : support.accounts
          ? 'Separate accounts can be connected.'
          : 'Uses the current CLI account only.',
    ],
    [
      'Quota reporting',
      support.capacity ? 'yes' : 'no',
      support.capacity
        ? 'Subscription capacity when the account reports it.'
        : 'No connected quota interface; usage depends on provider reports.',
    ],
  ];
  return (
    <section aria-label="Agent support" className="mt-4">
      <h3 className="text-base font-medium">Supported in Jackalope</h3>
      <ul className="agent-support-grid">
        {features.map(([label, state, detail]) => {
          const Icon = icons[state];
          return (
            <li key={label} data-state={state} title={detail}>
              <Icon size={14} aria-hidden="true" />
              <span>{label}</span>
              <span className="sr-only">
                {state === 'yes' ? 'Supported' : state === 'partial' ? 'Limited' : 'Not supported'}.{' '}
                {detail}
              </span>
            </li>
          );
        })}
      </ul>
      {adapter === 'kimi' && (
        <p className="task-muted">
          Legacy Python kimi-cli accounts need migration through the Kimi Code CLI.
        </p>
      )}
    </section>
  );
}
