import { Disclosure, DisclosureBody, DisclosureSummary, Table } from '@jackalope/ui';
import { ChartNoAxesColumn, Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { taskTitle } from '../../lib/task-title';
import { usageEntries } from '../../lib/usage-entries';
import {
  summarizeUsage,
  usageAccountKey,
  usageCutoff,
  usageDateKey,
  usageInsights,
} from '../../lib/usage-insights';
import { useExecutionStore } from '../../stores/executionStore';
import { useHelperStore } from '../../stores/helperStore';
import { useProjectStore } from '../../stores/projectStore';
import type { UsageView } from '../layout/navigation';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { FormField } from '../ui/FormField';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import { FilterGroup, WorkspaceToolbar } from '../ui/WorkspaceToolbar';
import { AgentMetricsDashboard } from './AgentMetricsDashboard';
import { CapacityPanel } from './CapacityPanel';
import { tokenLabel, UsageInsights } from './UsageInsights';
export function UsageDashboard({
  view = 'tokens',
  onTask,
}: {
  view?: UsageView;
  onTask: () => void;
}) {
  const { runs, select, loading, error, historyError, refresh } = useExecutionStore();
  const { projects, selectProject } = useProjectStore();
  const [project, setProject] = useState('all');
  const [period, setPeriod] = useState('30');
  const [account, setAccount] = useState('all');
  const entries = useMemo(() => usageEntries(runs), [runs]);
  const accountKey = usageAccountKey;
  const [agent, setAgent] = useState('all');
  const [ledger, setLedger] = useState<'tasks' | 'calls'>('tasks');
  const [date, setDate] = useState<string | null>(null);
  const helper = useHelperStore((s) => s.view);
  const helperError = useHelperStore((s) => s.syncError);
  const refreshHelper = useHelperStore((s) => s.refresh);
  const [helperLoading, setHelperLoading] = useState(true);
  useEffect(() => {
    let current = true;
    void refreshHelper().finally(() => {
      if (current) setHelperLoading(false);
    });
    return () => {
      current = false;
    };
  }, [refreshHelper]);
  const accounts = new Map(entries.map((r) => [accountKey(r), `${r.agent} · ${r.account}`]));
  const [sort, setSort] = useState('tokens');
  const projectNames = new Map([
    ...projects.map((p) => [p.id, p.name] as const),
    ...runs.map((r) => [r.projectId, r.projectName] as const),
  ]);
  const cutoff = usageCutoff(period);
  const filtered = useMemo(
    () =>
      entries.filter(
        (r) =>
          (project === 'all' || r.projectId === project) &&
          (account === 'all' || accountKey(r) === account) &&
          (agent === 'all' || r.agent === agent) &&
          (period === 'all' || new Date(r.startedAt).getTime() >= cutoff),
      ),
    [entries, project, account, agent, period, cutoff],
  );
  const insights = useMemo(() => usageInsights(filtered, runs, period), [filtered, runs, period]);
  const helperUsage = summarizeUsage(helper.turns);
  const ledgerEntries = date
    ? filtered.filter((r) => usageDateKey(r.startedAt, period === 'all') === date)
    : filtered;
  const sorted = [...ledgerEntries].sort((a, b) =>
    sort === 'account'
      ? accountKey(a).localeCompare(accountKey(b))
      : sort === 'project'
        ? a.projectName.localeCompare(b.projectName)
        : sort === 'agent'
          ? a.agent.localeCompare(b.agent)
          : sort === 'model'
            ? (a.model ?? '').localeCompare(b.model ?? '')
            : b.usage.input + b.usage.output - (a.usage.input + a.usage.output),
  );
  const sortedTasks = [...insights.tasks].sort((a, b) =>
    sort === 'project'
      ? a.run.projectName.localeCompare(b.run.projectName)
      : sort === 'agent'
        ? a.agents.join(',').localeCompare(b.agents.join(','))
        : sort === 'model'
          ? (a.run.model ?? '').localeCompare(b.run.model ?? '')
          : sort === 'account'
            ? a.run.account.localeCompare(b.run.account)
            : (b.tokens ?? -1) - (a.tokens ?? -1),
  );
  const exportUsage = () => {
    const data = filtered.map(
      ({
        id,
        taskId,
        purpose,
        usageKey,
        projectId,
        projectName,
        agent,
        account,
        accountBinding,
        usageObservations,
        effort,
        reasoningEffort,
        efficiency,
        model,
        startedAt,
        status,
        usage,
      }) => ({
        id,
        taskId,
        purpose,
        usageKey,
        projectId,
        projectName,
        agent,
        account,
        accountBinding: accountBinding
          ? {
              adapter: accountBinding.adapter,
              profileId: accountBinding.profileId,
              label: accountBinding.label,
            }
          : undefined,
        usageObservations,
        effort,
        reasoningEffort,
        efficiency,
        model,
        startedAt,
        status,
        usage,
      }),
    );
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              schema: 4,
              filters: { project, agent, account, period },
              taskActivity: {
                total: insights.total,
                routing: insights.routing,
                worker: insights.worker,
                handoffs: insights.handoffs,
                projects: insights.projects,
                agents: insights.agents,
                trend: insights.trend,
                outcomes: insights.outcomes,
                tasks: insights.tasks.map((t) => ({
                  taskId: t.run.taskId,
                  projectId: t.run.projectId,
                  latestRunId: t.run.id,
                  tokens: t.tokens,
                  missing: t.missing,
                  attempts: t.attempts,
                  outcome: t.outcome,
                })),
              },
              otherAppActivity:
                project === 'all' && account === 'all' && agent === 'all'
                  ? {
                      source:
                        'Ask Jackalope retained conversation; undated and excluded from task totals and period filters',
                      usage: helperUsage,
                      error: helperError ?? helper.error,
                      turns: helper.turns.map(({ id, agent, model, status, usage }) => ({
                        id,
                        agent,
                        model,
                        status,
                        usage,
                      })),
                    }
                  : undefined,
              breakdown: {
                routing: filtered.filter((r) => r.purpose === 'Routing').map((r) => r.usage),
                execution: filtered.filter((r) => r.purpose === 'Worker').map((r) => r.usage),
                quotaRetries: filtered
                  .filter((r) => r.purpose === 'Worker · quota handoff')
                  .map((r) => r.usage),
                verificationTokens: null,
              },
              coverage: 'Jackalope attempts only; missing usage is unavailable',
              attempts: data,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'jackalope-usage.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <WorkspacePage className="usage-page workspace-sections">
      <WorkspaceHeading
        title={view === 'analytics' ? 'Performance & insights' : 'Usage & quota'}
        description={
          view === 'tokens'
            ? 'Your account limits, token activity and the work behind them.'
            : undefined
        }
        action={
          view === 'tokens' && (
            <Button
              variant="outline"
              onClick={exportUsage}
              disabled={
                loading || Boolean(historyError) || (!filtered.length && !helper.turns.length)
              }
            >
              <Download size={18} />
              Export
            </Button>
          )
        }
      />

      {view === 'analytics' ? (
        <>
          {loading && <p role="status">Loading saved task history…</p>}
          {historyError && (
            <InlineNotice tone="error">
              {historyError}
              <Button variant="ghost" onClick={() => void refresh()}>
                Reload history
              </Button>
            </InlineNotice>
          )}
          <div hidden={loading || Boolean(historyError)}>
            <AgentMetricsDashboard runs={runs} />
          </div>
        </>
      ) : (
        <div className="workspace-sections">
          <CapacityPanel />
          <section className="workspace-section workspace-stack" aria-label="Task usage">
            <WorkspaceSectionHeading
              title="Task usage"
              description="Reported activity from your loaded Jackalope history."
            />
            <WorkspaceToolbar className="usage-filters">
              <FormField label="Account">
                <Select
                  id="usage-account"
                  aria-label="Usage account"
                  value={account}
                  onValueChange={(value) => {
                    setAccount(value);
                    setDate(null);
                  }}
                >
                  <SelectItem value="all">All accounts</SelectItem>
                  {[...accounts].map(([id, label]) => (
                    <SelectItem key={id} value={id}>
                      {label}
                    </SelectItem>
                  ))}
                </Select>
              </FormField>
              <FormField label="Project">
                <Select
                  id="usagedashboard-field-1"
                  aria-label="Project"
                  value={project}
                  onValueChange={(value) => {
                    setProject(value);
                    setDate(null);
                  }}
                >
                  <SelectItem value="all">All projects</SelectItem>
                  {[...projectNames].map(([id, name]) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </Select>
              </FormField>
              <FormField label="Period">
                <Select
                  id="usagedashboard-field-2"
                  aria-label="Period"
                  value={period}
                  onValueChange={(value) => {
                    setPeriod(value);
                    setDate(null);
                  }}
                >
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </Select>
              </FormField>
              <FormField label="Agent">
                <Select
                  id="usage-agent"
                  value={agent}
                  onValueChange={(value) => {
                    setAgent(value);
                    setDate(null);
                  }}
                >
                  <SelectItem value="all">All agents</SelectItem>
                  {[...new Set(entries.map((r) => r.agent))].sort().map((id) => (
                    <SelectItem key={id} value={id}>
                      {id}
                    </SelectItem>
                  ))}
                </Select>
              </FormField>
              <FormField label="Sort by">
                <Select
                  id="usagedashboard-field-3"
                  aria-label="Sort by"
                  value={sort}
                  onValueChange={(value) => setSort(value)}
                >
                  <SelectItem value="tokens">Tokens used</SelectItem>
                  <SelectItem value="project">Project</SelectItem>
                  <SelectItem value="agent">Agent</SelectItem>
                  <SelectItem value="model">Model</SelectItem>
                  <SelectItem value="account">Account</SelectItem>
                </Select>
              </FormField>
            </WorkspaceToolbar>
            {!loading && !historyError && filtered.length > 0 && (
              <UsageInsights
                data={insights}
                selectedDate={date}
                scope={
                  project === 'all' ? 'All projects' : (projectNames.get(project) ?? 'Project')
                }
                onProject={(id) => {
                  setProject(id);
                  setDate(null);
                }}
                onAgent={(id) => {
                  setAgent(id);
                  setDate(null);
                }}
                onDate={(value) => {
                  setDate(value);
                  setLedger('calls');
                  requestAnimationFrame(() => document.getElementById('usage-ledger')?.focus());
                }}
              />
            )}
            {historyError && (
              <InlineNotice
                tone="error"
                action={
                  <Button variant="outline" onClick={() => void refresh()}>
                    Reload history
                  </Button>
                }
              >
                Usage is unavailable because saved history could not be loaded. {historyError}
              </InlineNotice>
            )}
          </section>
          <section className="workspace-section workspace-stack" aria-label="Usage details">
            {!loading && !historyError && filtered.length > 0 && (
              <WorkspaceSectionHeading
                titleId="usage-ledger"
                title={date ? `Calls dated ${date}` : 'Explore the work'}
                action={
                  <div className="workspace-actions">
                    {date && (
                      <Button variant="outline" onClick={() => setDate(null)}>
                        Clear date
                      </Button>
                    )}
                    <FilterGroup
                      label="Usage detail"
                      value={ledger}
                      onChange={(value) => {
                        setLedger(value);
                        if (value === 'tasks') setDate(null);
                      }}
                      items={[
                        { id: 'tasks', label: 'Tasks' },
                        { id: 'calls', label: 'Individual calls' },
                      ]}
                    />
                  </div>
                }
              />
            )}
            {error && <InlineNotice tone="error">{error}</InlineNotice>}
            {loading ? (
              <p role="status">Loading usage…</p>
            ) : historyError ? null : !sorted.length ? (
              <EmptyState
                icon={ChartNoAxesColumn}
                title="No attempts in this view"
                description="Usage appears when agents report it. Try another project or period, or start a task."
                action={
                  <Button variant="outline" onClick={onTask}>
                    Go to tasks
                  </Button>
                }
              />
            ) : ledger === 'tasks' ? (
              <Table
                className="usage-ledger-table"
                label="Task usage across attempts in the selected filters, with latest saved outcomes"
              >
                <thead>
                  <tr>
                    <th>Task / project</th>
                    <th>Agents / attempts</th>
                    <th>Reported tokens</th>
                    <th>Selection overhead</th>
                    <th>Latest outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTasks.map((task) => (
                    <tr key={task.key}>
                      <td>
                        <button
                          type="button"
                          className="task-link usage-task-link min-h-11"
                          onClick={() => {
                            selectProject(task.run.projectId);
                            select(task.run.id);
                            onTask();
                          }}
                        >
                          {taskTitle(task.run.prompt)}
                        </button>
                        <small>{task.run.projectName}</small>
                      </td>
                      <td>
                        {task.agents.join(', ')}
                        <small>
                          {task.attempts} attempts · {task.calls} calls
                        </small>
                      </td>
                      <td>
                        {tokenLabel(task.tokens)}
                        {task.missing > 0 && <small>{task.missing} missing reports</small>}
                      </td>
                      <td>
                        {tokenLabel(task.routing.tokens)}
                        {task.routing.missing > 0 && <small>Partial</small>}
                      </td>
                      <td>
                        {task.outcome === 'accepted'
                          ? 'Accepted by you'
                          : task.outcome === 'changes'
                            ? 'Needs changes'
                            : 'Not measured'}
                        <small>
                          {task.run.status === 'review' ? 'Ready for review' : task.run.status}
                        </small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <Table className="usage-ledger-table" label="Usage for each execution attempt">
                <thead>
                  <tr>
                    <th>Task / project</th>
                    <th>Agent / model</th>
                    <th>Input</th>
                    <th>Output</th>
                    <th>Cost estimate</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((run) => (
                    <tr key={run.usageKey}>
                      <td>
                        <button
                          type="button"
                          className="task-link usage-task-link min-h-11"
                          onClick={() => {
                            selectProject(run.projectId);
                            select(run.id);
                            onTask();
                          }}
                        >
                          {taskTitle(run.prompt)}
                        </button>
                        <span className="task-muted text-xs block mt-1">
                          {run.projectName} · {new Date(run.startedAt).toLocaleDateString()}
                        </span>
                      </td>
                      <td>
                        {run.agent} · {run.purpose}
                        <span className="task-muted text-xs block mt-1">
                          {run.model || 'Not reported'}
                        </span>
                      </td>
                      <td>{run.usage.reported ? run.usage.input.toLocaleString() : '—'}</td>
                      <td>{run.usage.reported ? run.usage.output.toLocaleString() : '—'}</td>
                      <td>
                        {run.usage.estimatedCostUsd != null
                          ? `$${run.usage.estimatedCostUsd.toFixed(4)}`
                          : 'Unavailable'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {!historyError && !loading && filtered.some((r) => r.usageObservations?.length) && (
              <Disclosure>
                <DisclosureSummary>Message and subagent observations</DisclosureSummary>
                <DisclosureBody>
                  <p className="task-muted">Partial observations; not added to the totals above.</p>
                  {filtered
                    .filter((r) => r.usageObservations?.length)
                    .map((r) => (
                      <Disclosure key={r.usageKey}>
                        <DisclosureSummary>
                          {taskTitle(r.prompt)} · {r.usageObservations?.length} messages
                        </DisclosureSummary>
                        <DisclosureBody>
                          {r.usageObservations?.map((o) => (
                            <p className="task-muted" key={o.messageId}>
                              {o.parentToolUseId ? `Child ${o.parentToolUseId}` : 'Main agent'} ·{' '}
                              {o.model ?? 'Model unknown'} · {o.input.toLocaleString()} input /{' '}
                              {o.output.toLocaleString()} output
                            </p>
                          ))}
                        </DisclosureBody>
                      </Disclosure>
                    ))}
                </DisclosureBody>
              </Disclosure>
            )}
          </section>
        </div>
      )}
      {view === 'tokens' && (
        <div className="workspace-sections">
          <Disclosure className="usage-measurement">
            <DisclosureSummary>What these numbers include</DisclosureSummary>
            <DisclosureBody>
              <p>
                Only loaded Jackalope task history is included. Archived, deleted or unreadable
                history and work in other apps are excluded. Totals include routing failures,
                quota-interrupted workers and continuation attempts. Unknown reports stay
                unavailable; a partial total is only the known portion.
              </p>
              <p>
                Input includes cached input; cache reads and message/subagent observations are not
                added again. Reported tokens are not a provider invoice or subscription quota. Exact
                tokens for prompts, coordination tools, verification and internal retries cannot be
                split out of worker totals.
              </p>
              <p>
                Opening this dashboard does not send a model prompt. Connected capacity is an
                account-wide read and may include other apps; it is not added to task usage.
              </p>
            </DisclosureBody>
          </Disclosure>
          {project === 'all' && agent === 'all' && account === 'all' && (
            <section
              className="usage-app-activity workspace-section workspace-stack"
              aria-label="Other app activity"
            >
              <WorkspaceSectionHeading
                title="Other app activity"
                description="Ask Jackalope · retained conversation, separate from task totals. These turns have no saved dates or project links, so the period filter does not apply."
                action={
                  <Button variant="outline" onClick={() => void refreshHelper()}>
                    Refresh helper history
                  </Button>
                }
              />
              {helperLoading ? (
                <p role="status">Loading helper history…</p>
              ) : helperError || helper.error ? (
                <InlineNotice tone="error">
                  Helper usage could not be refreshed. {helperError ?? helper.error}
                </InlineNotice>
              ) : (
                <p className="task-muted">
                  {helper.turns.length ? tokenLabel(helperUsage.tokens) : 'No saved turns'}
                  {helper.turns.length > 0 &&
                    ` reported tokens · ${helperUsage.reported} of ${helperUsage.calls} turns reported usage`}
                </p>
              )}
              {helper.turns.length > 0 && !helperError && !helper.error && (
                <Disclosure>
                  <DisclosureSummary>Inspect helper usage by turn</DisclosureSummary>
                  <DisclosureBody>
                    <Table
                      className="usage-ledger-table"
                      label="Retained Ask Jackalope turns, not filtered by date"
                    >
                      <thead>
                        <tr>
                          <th>Turn</th>
                          <th>Agent / model</th>
                          <th>Status</th>
                          <th>Reported tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {helper.turns.map((turn, i) => (
                          <tr key={turn.id}>
                            <td>{i + 1}</td>
                            <td>
                              {turn.agent}
                              <small>{turn.model ?? 'Model not reported'}</small>
                            </td>
                            <td>{turn.status}</td>
                            <td>
                              {turn.usage.reported
                                ? tokenLabel(turn.usage.input + turn.usage.output)
                                : 'Unavailable'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </DisclosureBody>
                </Disclosure>
              )}
            </section>
          )}
        </div>
      )}
    </WorkspacePage>
  );
}
