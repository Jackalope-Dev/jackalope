import { useMemo, useState } from 'react';
import { computeAgentAnalytics } from '../../lib/agent-analytics';
import { generateAgentInsights, type WorkflowInsight } from '../../lib/agent-insights';
import { executionEvaluation } from '../../lib/execution-evaluation';
import type { KnowledgeEntry } from '../../lib/knowledge';
import { openKnowledgeTask, useKnowledge } from '../../lib/knowledge';
import type { TaskRun } from '../../lib/task-runtime';
import { taskTitle } from '../../lib/task-title';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { useProjectStore } from '../../stores/projectStore';
import { KnowledgeEditor } from '../knowledge/KnowledgeEditor';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';

export function AgentMetricsDashboard({ runs }: { runs: TaskRun[] }) {
  const projects = useProjectStore((state) => state.projects);
  const [projectId, setProjectId] = useState('all');
  const [category, setCategory] = useState<'all' | WorkflowInsight['category']>('all');
  const [editing, setEditing] = useState<KnowledgeEntry | null>(null);
  const [sourceError, setSourceError] = useState('');
  const openSource = (project: string, run: string) => {
    setSourceError('');
    void openKnowledgeTask(project, run).catch((cause) => setSourceError(String(cause)));
  };
  const project = projects.find((item) => item.id === projectId);
  const scoped = useMemo(
    () => runs.filter((run) => projectId === 'all' || run.projectId === projectId),
    [runs, projectId],
  );
  const evaluation = useMemo(() => executionEvaluation(scoped), [scoped]);
  const [copied, setCopied] = useState(false);
  const analytics = useMemo(() => computeAgentAnalytics(scoped), [scoped]);
  const insights = useMemo(() => generateAgentInsights(scoped), [scoped]);
  const knowledge = useKnowledge(project?.id ?? '', project?.path ?? '');
  const lessons = knowledge.error ? [] : knowledge.entries.filter((entry) => entry.automatic);
  const automaticQuotaHandoff = useAgentConfigStore((state) => state.automaticQuotaHandoff);
  const [savingHandoff, setSavingHandoff] = useState(false);
  const [handoffError, setHandoffError] = useState('');
  const changeHandoff = async (enabled: boolean) => {
    const previous = useAgentConfigStore.getState().automaticQuotaHandoff;
    setSavingHandoff(true);
    setHandoffError('');
    useAgentConfigStore.setState({ automaticQuotaHandoff: enabled });
    try {
      await syncAgentConfig();
    } catch (cause) {
      useAgentConfigStore.setState({ automaticQuotaHandoff: previous });
      setHandoffError(`Could not save handoff setting: ${String(cause)}`);
    } finally {
      setSavingHandoff(false);
    }
  };
  const shown = insights.filter((insight) => category === 'all' || insight.category === category);
  const names = new Map([
    ...projects.map((item) => [item.id, item.name] as const),
    ...runs.map((run) => [run.projectId, run.projectName] as const),
  ]);
  return (
    <div className="agent-metrics-dashboard space-y-6">
      {sourceError && (
        <p role="alert" className="task-error">
          {sourceError}
        </p>
      )}
      <div className="usage-filters">
        <label htmlFor="insights-project">
          Project
          <Select id="insights-project" value={projectId} onValueChange={setProjectId}>
            <SelectItem value="all">All projects</SelectItem>
            {[...names].map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </Select>
        </label>
      </div>
      <p className="task-muted">
        Loaded Jackalope history only. Acceptance uses the latest saved attempt per task with
        explicit outcome-review decisions. Records describe the reviewed snapshot; files may have
        changed since.
      </p>
      <section className="space-y-3">
        <h2>Execution time</h2>
        <p className="task-muted">
          Recorded work time across attempts. Parallel stages overlap in wall time; older tasks may
          have no timing records.
        </p>
        {Object.entries(evaluation.stageTotalsMs).map(([stage, ms]) => (
          <p key={stage}>
            {stage.replaceAll('_', ' ')}: {(ms / 1000).toFixed(1)}s
          </p>
        ))}
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard
              .writeText(JSON.stringify(evaluation, null, 2))
              .then(() => setCopied(true))
              .catch((error) => setSourceError(String(error)));
          }}
        >
          {copied ? 'Copied evaluation data' : 'Copy evaluation data'}
        </Button>
      </section>
      <dl className="grid grid-cols-2 gap-4">
        {[
          [
            'Recorded acceptance',
            analytics.outcomes.acceptanceRate === null
              ? 'Not measured'
              : `${analytics.outcomes.acceptanceRate}%`,
            `${analytics.outcomes.accepted} accepted / ${analytics.outcomes.measured} with outcome decisions; ${analytics.outcomes.total - analytics.outcomes.measured} without a complete decision`,
          ],
          [
            'Saved context supplied',
            String(analytics.contextTasks),
            `of ${analytics.outcomes.total} latest task attempts; inclusion does not prove the agent followed it`,
          ],
          [
            'Quota handoffs recorded',
            String(analytics.handoffs),
            `${analytics.completedAfterHandoff} attempts finished after a handoff`,
          ],
          [
            'Changes requested',
            String(analytics.outcomes.changes),
            'Latest saved outcome decisions',
          ],
        ].map(([label, value, detail]) => (
          <div key={label} className="p-4 rounded-lg border border-[var(--color-border)]">
            <dt className="task-muted">{label}</dt>
            <dd className="text-xl font-semibold mt-1">{value}</dd>
            <dd className="task-muted mt-2">{detail}</dd>
          </div>
        ))}
      </dl>
      <section className="space-y-3" aria-label="Findings from task history">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg">Findings from task history</h2>
          <Select
            aria-label="Insight category"
            value={category}
            onValueChange={(value) => setCategory(value as typeof category)}
          >
            {(['all', 'review', 'checks', 'learning', 'resilience'] as const).map((value) => (
              <SelectItem key={value} value={value}>
                {value === 'all' ? 'All findings' : value[0].toUpperCase() + value.slice(1)}
              </SelectItem>
            ))}
          </Select>
        </div>
        {!shown.length && (
          <p className="task-muted" role="status">
            No findings in this view. Recorded review feedback, failed checks, quota handoffs and
            context comparisons appear when the history supports them.
          </p>
        )}
        {shown.map((insight) => (
          <article
            key={insight.id}
            className="py-3 border-b border-[var(--color-border)] space-y-2"
          >
            <h3 className="font-medium">{insight.title}</h3>
            <p className="task-muted">{insight.description}</p>
            <details>
              <summary className="cursor-pointer min-h-11 py-3">
                Inspect {insight.runs.length} source task(s)
              </summary>
              <ul>
                {insight.runs.map((run) => (
                  <li key={run.id}>
                    <Button
                      variant="ghost"
                      className="max-w-full whitespace-normal text-left"
                      onClick={() => openSource(run.projectId, run.id)}
                    >
                      {run.projectName} · {taskTitle(run.prompt).slice(0, 100) || run.id}
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          </article>
        ))}
      </section>
      <section className="space-y-3" aria-label="Automatic project lessons">
        <h2 className="text-lg">Automatic project lessons</h2>
        <p className="task-muted">
          Explicit preferences, review corrections and repository tooling are saved locally and
          matched to future tasks. Edit or pause a lesson here; remove it in Project → Context.
          Current instructions take precedence.
        </p>
        {!project ? (
          <p className="task-muted">Choose a registered project to inspect its lessons.</p>
        ) : !isTauriEnvironment() ? (
          <p className="task-notice">Open the desktop app to inspect local project lessons.</p>
        ) : (
          <>
            {knowledge.loading && <p role="status">Reading project evidence…</p>}
            {knowledge.error && (
              <p className="task-error" role="alert">
                {knowledge.error}
                <Button variant="ghost" onClick={() => void knowledge.refresh()}>
                  Retry
                </Button>
              </p>
            )}
            {!knowledge.loading && !knowledge.error && !lessons.length && (
              <p className="task-muted">
                No automatic lessons found in the inspected history or supported repository files.
              </p>
            )}
            {lessons.map((entry) => {
              const uses = new Set(
                scoped
                  .filter((run) => run.contextReceipt?.entries.some((item) => item.id === entry.id))
                  .map((run) => run.taskId),
              ).size;
              return (
                <article
                  key={entry.id}
                  className="py-3 border-b border-[var(--color-border)] space-y-2"
                >
                  <div className="flex flex-wrap justify-between items-center gap-2">
                    <h3 className="font-medium">{entry.title}</h3>
                    <Button variant="outline" onClick={() => setEditing(entry)}>
                      Edit lesson
                    </Button>
                  </div>
                  <p className="task-muted">
                    {entry.enabled ? 'Available for matching' : 'Paused'} · Supplied to {uses}{' '}
                    task(s) in loaded history ·{' '}
                    {entry.automatic?.managed ? 'Automatically maintained' : 'Edited by you'}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{entry.content}</p>
                  <details>
                    <summary className="cursor-pointer min-h-11 py-3">
                      Source evidence and matching
                    </summary>
                    <p className="task-muted">Matches: {entry.keywords.join(', ')}</p>
                    {entry.automatic?.evidence.map((evidence) => (
                      <p className="task-muted break-words" key={evidence}>
                        {evidence}
                      </p>
                    ))}
                    {entry.sourceRunId && (
                      <Button
                        variant="ghost"
                        onClick={() => openSource(entry.projectId, entry.sourceRunId as string)}
                      >
                        Open source task
                      </Button>
                    )}
                  </details>
                </article>
              );
            })}
          </>
        )}
      </section>
      <section className="space-y-3" aria-label="Recorded agent runs">
        <h2 className="text-lg">Recorded agent runs</h2>
        <p className="task-muted">
          Grouped by the final assigned agent. Duration excludes active attempts and attempts with
          handoffs. Task complexity differs; these averages do not rank agents or measure
          acceptance.
        </p>
        {!analytics.metrics.length ? (
          <p className="task-muted">No runs recorded in this view.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr>
                  {['Agent', 'Attempts', 'Finished', 'Failed', 'Mean duration'].map((label) => (
                    <th key={label} className="p-3 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analytics.metrics.map((metric) => (
                  <tr key={metric.agent} className="border-t border-[var(--color-border)]">
                    <th scope="row" className="p-3 font-medium">
                      {metric.agent}
                    </th>
                    <td className="p-3">{metric.attempts}</td>
                    <td className="p-3">{metric.completed}</td>
                    <td className="p-3">{metric.failed}</td>
                    <td className="p-3">
                      {metric.avgDurationMs === null
                        ? 'Not reported'
                        : `${Math.round(metric.avgDurationMs / 1000)}s (${metric.durationSamples} samples)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <details className="border-t border-[var(--color-border)] pt-3">
        <summary className="cursor-pointer min-h-11 py-3">Automatic quota handoff setting</summary>
        <Switch
          label="Automatic quota handoff"
          checked={automaticQuotaHandoff}
          disabled={savingHandoff || !isTauriEnvironment()}
          onCheckedChange={(value) => void changeHandoff(value)}
        />
        {handoffError && (
          <p role="alert" className="task-error">
            {handoffError}
          </p>
        )}
      </details>
      {editing && (
        <KnowledgeEditor
          key={editing.id}
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void knowledge.refresh();
          }}
        />
      )}
    </div>
  );
}
