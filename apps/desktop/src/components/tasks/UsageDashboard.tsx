import { Disclosure, DisclosureBody, DisclosureSummary, Table } from '@jackalope/ui';
import { ChartNoAxesColumn, Download } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { countedTaskDecisions } from '../../lib/decision-usage';
import { nativeTask } from '../../lib/task-runtime';
import { taskTitle } from '../../lib/task-title';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { usageEntries } from '../../lib/usage-entries';
import {
  type HelperAccountingTurn,
  selectHelperTurns,
  summarizeUsage,
  usageAccountKey,
  usageCutoff,
  usageDateKey,
  usageInsights,
} from '../../lib/usage-insights';
import { useExecutionStore } from '../../stores/executionStore';
import { useHelperStore } from '../../stores/helperStore';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { FormField } from '../ui/FormField';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import { FilterGroup, WorkspaceToolbar } from '../ui/WorkspaceToolbar';
import { CapacityPanel } from './CapacityPanel';
import { DecisionUsage, useTaskDecisionUsage } from './DecisionUsage';
import { JevConnectionUsage } from './JevConnectionUsage';
import { tokenLabel, UsageInsights } from './UsageInsights';
import { WorkflowPerformance } from './WorkflowPerformance';
export function UsageDashboard({ onTask }: { onTask: () => void }) {
  const { runs, select, loading, error, historyError, refresh } = useExecutionStore(
    useShallow((s) => ({
      runs: s.runs,
      select: s.select,
      loading: s.loading,
      error: s.error,
      historyError: s.historyError,
      refresh: s.refresh,
    })),
  );
  const { projects, selectProject } = useProjectStore(
    useShallow((s) => ({ projects: s.projects, selectProject: s.selectProject })),
  );
  const [project, setProject] = useState('all');
  const [period, setPeriod] = useState('30');
  const [account, setAccount] = useState('all');
  const entries = useMemo(() => usageEntries(runs), [runs]);
  const accountKey = usageAccountKey;
  const [agent, setAgent] = useState('all');
  const [ledger, setLedger] = useState<'tasks' | 'calls'>('tasks');
  const [date, setDate] = useState<string | null>(null);
  const decisionUsage = useTaskDecisionUsage();
  const helper = useHelperStore((s) => s.view);
  const helperError = useHelperStore((s) => s.syncError);
  const refreshHelper = useHelperStore((s) => s.refresh);
  const [helperReport, setHelperReport] = useState<{
    turns: HelperAccountingTurn[];
    unavailable: string[];
  } | null>(null);
  const [helperLedgerError, setHelperLedgerError] = useState<string | null>(null);
  const [helperLoading, setHelperLoading] = useState(isTauriEnvironment());
  const loadHelperLedger = useCallback(async () => {
    await refreshHelper();
    if (!isTauriEnvironment()) return;
    try {
      const report = await nativeTask<{ turns: HelperAccountingTurn[]; unavailable: string[] }>(
        'helper_usage',
      );
      setHelperReport(report);
      setHelperLedgerError(null);
    } catch (error) {
      setHelperLedgerError(String(error));
    }
  }, [refreshHelper]);
  useEffect(() => {
    let current = true;
    void loadHelperLedger().finally(() => {
      if (current) setHelperLoading(false);
    });
    return () => {
      current = false;
    };
  }, [loadHelperLedger]);
  const accounts = new Map(entries.map((r) => [accountKey(r), `${r.agent} · ${r.account}`]));
  for (const turn of helperReport?.turns ?? []) {
    if (turn.accountKey && !accounts.has(turn.accountKey))
      accounts.set(turn.accountKey, `${turn.agent} · ${turn.account || 'Account not recorded'}`);
  }
  const [sort, setSort] = useState('tokens');
  const projectNames = new Map([
    ...projects.map((p) => [p.id, p.name] as const),
    ...runs.map((r) => [r.projectId, r.projectName] as const),
  ]);
  const cutoff = usageCutoff(period);
  const showAssessments = agent === 'all' && account === 'all';
  const assessments = showAssessments
    ? countedTaskDecisions(decisionUsage.records, project === 'all' ? undefined : project, cutoff)
    : [];
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
  const helperTurns = useMemo(
    () =>
      selectHelperTurns(helperReport?.turns ?? [], {
        project,
        agent,
        account,
        period,
        cutoff,
      }).sort((a, b) => (b.createdAt ?? -1) - (a.createdAt ?? -1)),
    [helperReport, project, agent, account, period, cutoff],
  );
  const helperUsage = summarizeUsage(helperTurns);
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
        codexSpeed,
        requestedServiceTier,
        efficiency,
        mcpUsage,
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
        codexSpeed,
        requestedServiceTier,
        efficiency,
        mcpUsage,
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
              schema: 6,
              filters: { project, agent, account, period },
              taskAssessments: showAssessments
                ? {
                    coverage:
                      'Project and period scoped; includes calls that did not launch work; distinct from task execution and worker routing',
                    error: decisionUsage.error || undefined,
                    assessments: decisionUsage.error ? [] : assessments,
                  }
                : undefined,
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
                helperReport || helperLedgerError || helperError || helper.error
                  ? {
                      source:
                        'Ask Jackalope current and archived conversations. Separate from task totals. A period filter omits turns with no recorded date. Unreadable files are listed and left on disk.',
                      usage: helperUsage,
                      error: helperLedgerError ?? helperError ?? helper.error ?? undefined,
                      unavailable: helperReport?.unavailable ?? [],
                      turns: helperTurns.map(
                        ({
                          id,
                          createdAt,
                          projectId,
                          projectName,
                          agent,
                          account,
                          accountKey,
                          model,
                          status,
                          usage,
                          archived,
                        }) => ({
                          id,
                          createdAt: createdAt ?? null,
                          projectId: projectId ?? null,
                          projectName: projectName ?? null,
                          agent,
                          account,
                          accountKey: accountKey ?? null,
                          model,
                          status,
                          usage,
                          archived: archived ?? false,
                        }),
                      ),
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
        title="Usage & quota"
        description="Your account limits, token activity and the work behind them."
        action={
          <Button
            variant="outline"
            onClick={exportUsage}
            disabled={
              loading ||
              Boolean(historyError) ||
              (showAssessments && decisionUsage.loading) ||
              (!filtered.length && !helper.turns.length && !assessments.length)
            }
          >
            <Download size={18} />
            Export
          </Button>
        }
      />
      <div className="workspace-sections">
        <WorkflowPerformance />
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
                {[
                  ...new Set([
                    ...entries.map((r) => r.agent),
                    ...(helperReport?.turns.map((turn) => turn.agent) ?? []),
                  ]),
                ]
                  .filter(Boolean)
                  .sort()
                  .map((id) => (
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
              scope={project === 'all' ? 'All projects' : (projectNames.get(project) ?? 'Project')}
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
        {showAssessments && (
          <DecisionUsage
            {...decisionUsage}
            projectId={project === 'all' ? undefined : project}
            cutoff={cutoff}
          />
        )}
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
        </section>
      </div>
      <div className="workspace-sections">
        <Disclosure className="usage-measurement">
          <DisclosureSummary>What these numbers include</DisclosureSummary>
          <DisclosureBody>
            <p>
              Only loaded Jackalope task history is included. Archived, deleted or unreadable
              history and work in other apps are excluded. Totals include routing failures,
              quota-interrupted workers and continuation attempts. Unknown reports stay unavailable;
              a partial total is only the known portion.
            </p>
            <p>
              Input includes cached input; cache reads and message/subagent observations are not
              added again. Reported tokens are not a provider invoice or subscription quota. Exact
              tokens for prompts, coordination tools, verification and internal retries cannot be
              split out of worker totals.
            </p>
            <p>
              Opening this dashboard does not send a model prompt. Connected capacity is an
              account-wide read and may include other apps; it is not added to task usage. Ask
              Jackalope stays separate from task totals. New turns record a date and, when project
              sharing is current, the open project. Older turns have no date and appear in All time.
              Archived conversations stay in that list.
            </p>
          </DisclosureBody>
        </Disclosure>
        {(isTauriEnvironment() || helperReport || helperLedgerError) && (
          <section
            className="usage-app-activity workspace-section workspace-stack"
            aria-label="Ask Jackalope usage"
          >
            <WorkspaceSectionHeading
              title="Ask Jackalope"
              description="Separate from task totals. Project, account and period filters apply to dated turns."
              action={
                <Button variant="outline" onClick={() => void loadHelperLedger()}>
                  Refresh helper history
                </Button>
              }
            />
            {helperLoading ? (
              <p role="status">Loading helper history…</p>
            ) : helperLedgerError || helperError || helper.error ? (
              <InlineNotice tone="error">
                Helper usage could not be refreshed.{' '}
                {helperLedgerError ?? helperError ?? helper.error}
              </InlineNotice>
            ) : (
              <p className="task-muted">
                {helperTurns.length
                  ? `${tokenLabel(helperUsage.tokens)} reported tokens · ${helperUsage.reported} of ${helperUsage.calls} turns reported usage`
                  : (helperReport?.turns.length ?? 0) > 0
                    ? 'No Ask Jackalope turns match these filters.'
                    : 'No saved turns'}
              </p>
            )}
            {(helperReport?.unavailable.length ?? 0) > 0 && (
              <InlineNotice tone="error">
                {helperReport?.unavailable.length === 1
                  ? '1 helper record could not be read and was left on disk.'
                  : `${helperReport?.unavailable.length} helper records could not be read and were left on disk.`}{' '}
                {helperReport?.unavailable.slice(0, 5).join(', ')}
                {(helperReport?.unavailable.length ?? 0) > 5
                  ? ` and ${(helperReport?.unavailable.length ?? 0) - 5} more`
                  : ''}
              </InlineNotice>
            )}
            {helperTurns.length > 0 && !helperLedgerError && !helperError && !helper.error && (
              <Table
                className="usage-ledger-table"
                label="Ask Jackalope turns for the selected filters"
              >
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Project</th>
                    <th>Agent / model</th>
                    <th>Status</th>
                    <th>Reported tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {helperTurns.map((turn) => (
                    <tr key={`${turn.archived ? 'archived' : 'current'}-${turn.id}`}>
                      <td>
                        {turn.createdAt == null
                          ? 'Date not recorded'
                          : new Date(turn.createdAt).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                        {turn.archived ? <small>Archived</small> : null}
                      </td>
                      <td>
                        {turn.projectName ||
                          (turn.projectId ? 'Removed project' : 'Not attributed')}
                      </td>
                      <td>
                        {turn.agent || 'Agent not recorded'}
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
            )}
            {period !== 'all' &&
              (helperReport?.turns.some((turn) => turn.createdAt == null) ?? false) && (
                <p className="task-muted">
                  Turns saved before a date was recorded are visible in All time.
                </p>
              )}
          </section>
        )}
        {project === 'all' && agent === 'all' && account === 'all' && <JevConnectionUsage />}
      </div>
    </WorkspacePage>
  );
}
