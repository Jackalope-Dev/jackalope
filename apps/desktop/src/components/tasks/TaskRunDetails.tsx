import { DefinitionList, Disclosure, DisclosureSummary } from '@jackalope/ui';
import type { TaskRun } from '../../lib/task-runtime';
import { describeRunUsage } from '../../lib/usage-insights';
import { TaskLearning } from '../knowledge/TaskLearning';
import { TaskTiming } from './TaskTiming';
import { UserPromptCard } from './UserPromptCard';

/** Agent, routing, usage and diagnostic records for one attempt. */
export function TaskRunDetails({
  run,
  attempts,
  active,
}: {
  run: TaskRun;
  attempts: TaskRun[];
  active: boolean;
}) {
  const routing = run.routing;
  return (
    <section className="task-environment" aria-label="Context, history and usage">
      {run.status !== 'reviewed' && <TaskLearning key={`knowledge:${run.id}`} run={run} />}
      <DefinitionList
        items={[
          { label: 'Agent', value: run.agent },
          { label: 'Model', value: run.model || 'Agent default' },
          { label: 'Account', value: run.accountBinding?.label || run.account },
          { label: 'Started', value: new Date(run.startedAt).toLocaleString() },
          ...(run.endedAt
            ? [{ label: 'Ended', value: new Date(run.endedAt).toLocaleString() }]
            : []),
          {
            label: 'Workspace',
            value: run.workspace || (active ? 'Preparing' : 'Not recorded'),
          },
          { label: 'Branch', value: run.branch || 'Not recorded' },
          { label: 'Target', value: run.targetBranch || 'Not recorded' },
        ]}
      />
      {!!run.dependencySnapshot?.sources.length && (
        <Disclosure className="task-notice">
          <DisclosureSummary>
            Verified feature inputs ({run.dependencySnapshot.sources.length})
          </DisclosureSummary>
          {run.dependencySnapshot.sources.map((source) => (
            <p key={source.runId}>
              {source.runId} · {source.tree.slice(0, 12)}
            </p>
          ))}
        </Disclosure>
      )}
      <Disclosure className="my-4">
        <DisclosureSummary>Original request</DisclosureSummary>
        <p className="task-request whitespace-pre-wrap">{attempts[0]?.prompt ?? run.prompt}</p>
      </Disclosure>
      {attempts.length > 1 && (
        <Disclosure className="my-4">
          <DisclosureSummary>Instruction for this attempt</DisclosureSummary>
          <p className="task-request whitespace-pre-wrap">{run.prompt}</p>
        </Disclosure>
      )}
      {routing && (
        <Disclosure className="my-4">
          <DisclosureSummary>Agent selection and handoffs</DisclosureSummary>
          {!routing.decisions.length && (
            <p className="task-muted">Checking available agents, models and account quotas.</p>
          )}
          <ol className="space-y-3 mt-3">
            {routing.decisions.map((decision, index) => (
              <li key={decision.checkedAt}>
                <p>
                  {decision.agent} · {decision.model || 'CLI default model'} · {decision.account}
                </p>
                <p className="task-muted">{decision.reason}</p>
                <p className="task-muted">
                  Selected by {decision.orchestrator} ·{' '}
                  {decision.remainingPercent === null
                    ? 'Quota unknown'
                    : `${Math.round(decision.remainingPercent)}% headroom after local reservations at selection`}{' '}
                  · Routing usage:{' '}
                  {decision.usage.reported
                    ? `${(decision.usage.input + decision.usage.output).toLocaleString()} tokens`
                    : 'not reported'}
                </p>
                {routing.handoffs[index] && (
                  <p className="task-muted">
                    Quota handoff · {routing.handoffs[index].failure.message} · Worker usage:{' '}
                    {routing.handoffs[index].usage.reported
                      ? `${(routing.handoffs[index].usage.input + routing.handoffs[index].usage.output).toLocaleString()} tokens`
                      : 'not reported'}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </Disclosure>
      )}
      {run.prompts
        ?.filter((p) => p.status === 'answered')
        .map((p) => (
          <UserPromptCard key={p.id} runId={run.id} prompt={p} active={false} />
        ))}
      <p className="task-muted mt-3">
        {run.requestedServiceTier && (
          <>
            Codex processing requested:{' '}
            {run.requestedServiceTier === 'fast' ? 'Fast · higher usage' : 'Standard'}. Provider
            confirmation is unavailable.
            <br />
          </>
        )}
        {run.effort && (
          <>
            Task approach: {run.effort} · Model effort:{' '}
            {run.reasoningEffort ? `${run.reasoningEffort} requested` : 'Agent default'}
            <br />
          </>
        )}
        Reported usage:{' '}
        {run.usage.reported ? describeRunUsage(run) : 'Unavailable for this attempt'}
      </p>
      <TaskTiming run={run} />
      {run.mcpUsage && (
        <Disclosure className="my-3">
          <DisclosureSummary>
            Tool discovery · {run.mcpUsage.calls} {run.mcpUsage.calls === 1 ? 'call' : 'calls'}
          </DisclosureSummary>
          <p className="task-muted mt-2">
            Searches: {run.mcpUsage.searches} · Catalog tools: {run.mcpUsage.catalogTools} · Failed
            calls: {run.mcpUsage.failures}
          </p>
          <p className="task-muted">
            {(run.mcpUsage.schemaBytesReturned / 1024).toFixed(1)} KB tool definitions returned
            across searches (catalog size: {(run.mcpUsage.catalogBytes / 1024).toFixed(1)} KB).
          </p>
        </Disclosure>
      )}
      {!!run.diagnostics.length && (
        <Disclosure>
          <DisclosureSummary>Agent diagnostics</DisclosureSummary>
          <pre className="task-output">{run.diagnostics.join('\n\n')}</pre>
        </Disclosure>
      )}
    </section>
  );
}
