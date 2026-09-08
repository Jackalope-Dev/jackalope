import { agentCapabilities } from '../../lib/agent-capabilities';

export function AgentSupport({ adapter }: { adapter: string }) {
  const support = agentCapabilities(adapter);
  if (!support)
    return <p className="task-muted">Choose a supported adapter to see its capabilities.</p>;
  const rows = [
    ['Project context, task awareness & messages', 'Available'],
    [
      'User questions & validation',
      support.bridge === 'mcp' ? 'Built-in tools' : 'Through permitted shell/network tools',
    ],
    [
      'Browser evidence & interaction',
      adapter === 'codex'
        ? 'Read tools; actions may require permission'
        : 'Subject to CLI permissions',
    ],
    [
      'Selected project connections',
      support.direct.length ? 'Direct and on-demand tools' : 'On-demand tools',
    ],
    ['Continuation, stop & saved history', 'Available'],
    ['Separate accounts', support.accounts ? 'Available' : 'Current CLI account only'],
    ['Subscription capacity', support.capacity ? 'When reported by the account' : 'Not reported'],
  ];
  return (
    <section aria-label="Agent support" className="mt-4">
      <h3 className="text-base font-medium">Supported in Jackalope</h3>
      <dl className="agent-support-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="task-muted">
        Messages arrive at checkpoints. Usage depends on provider reports.
      </p>
    </section>
  );
}
