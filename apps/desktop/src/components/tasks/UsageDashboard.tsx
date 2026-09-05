import { ChartNoAxesColumn, Download } from 'lucide-react';
import { useState } from 'react';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { Select, SelectItem } from '../ui/Select';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { CapacityPanel } from './CapacityPanel';

export function UsageDashboard({ onTask }: { onTask: () => void }) {
  const { runs, select, loading, error } = useExecutionStore();
  const { projects, selectProject } = useProjectStore();
  const [project, setProject] = useState('all');
  const [period, setPeriod] = useState('30');
  const [sort, setSort] = useState('tokens');
  const projectNames = new Map([
    ...projects.map((p) => [p.id, p.name] as const),
    ...runs.map((r) => [r.projectId, r.projectName] as const),
  ]);
  const cutoff = period === 'all' ? 0 : Date.now() - Number(period) * 86400000;
  const filtered = runs.filter(
    (r) =>
      (project === 'all' || r.projectId === project) && new Date(r.startedAt).getTime() >= cutoff,
  );
  const reported = filtered.filter((r) => r.usage.reported);
  const input = reported.reduce((sum, r) => sum + r.usage.input, 0);
  const output = reported.reduce((sum, r) => sum + r.usage.output, 0);
  const sorted = [...filtered].sort((a, b) =>
    sort === 'project'
      ? a.projectName.localeCompare(b.projectName)
      : sort === 'agent'
        ? a.agent.localeCompare(b.agent)
        : sort === 'model'
          ? (a.model ?? '').localeCompare(b.model ?? '')
          : b.usage.input + b.usage.output - (a.usage.input + a.usage.output),
  );
  const exportUsage = () => {
    const data = filtered.map(
      ({
        id,
        taskId,
        projectId,
        projectName,
        agent,
        account,
        model,
        startedAt,
        status,
        usage,
      }) => ({
        id,
        taskId,
        projectId,
        projectName,
        agent,
        account,
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
              schema: 1,
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
    <section className="task-page usage-page">
      <WorkspaceHeading
        title="Usage"
        description="Tokens used by your tasks, and capacity across your accounts."
        action={
          <Button variant="outline" onClick={exportUsage} disabled={!filtered.length}>
            <Download size={18} />
            Export
          </Button>
        }
      />
      <div className="usage-filters">
        <label htmlFor="usagedashboard-field-1">
          Project
          <Select
            id="usagedashboard-field-1"
            aria-label="Project"
            value={project}
            onValueChange={(value) => setProject(value)}
          >
            <SelectItem value="all">All projects</SelectItem>
            {[...projectNames].map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </Select>
        </label>
        <label htmlFor="usagedashboard-field-2">
          Period
          <Select
            id="usagedashboard-field-2"
            aria-label="Period"
            value={period}
            onValueChange={(value) => setPeriod(value)}
          >
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </Select>
        </label>
        <label htmlFor="usagedashboard-field-3">
          Sort by
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
          </Select>
        </label>
      </div>
      {filtered.length > 0 && (
        <>
          <div className="usage-overview">
            <div>
              <p className="task-label">Reported tokens</p>
              <p className="usage-total">
                {reported.length ? (input + output).toLocaleString() : '—'}
              </p>
            </div>
            <div className="usage-breakdown">
              {reported.length > 0 && (
                <>
                  <div className="usage-key">
                    <span>
                      <i className="usage-bar-input" aria-hidden="true" />
                      Input {input.toLocaleString()}
                    </span>
                    <span>
                      <i className="usage-bar-output" aria-hidden="true" />
                      Output {output.toLocaleString()}
                    </span>
                  </div>
                  <div
                    className="usage-bar"
                    role="img"
                    aria-label={`${input.toLocaleString()} input tokens; ${output.toLocaleString()} output tokens`}
                  >
                    <span
                      className="usage-bar-input"
                      style={{ width: `${input + output ? (input / (input + output)) * 100 : 0}%` }}
                    />
                    <span
                      className="usage-bar-output"
                      style={{
                        width: `${input + output ? (output / (input + output)) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </>
              )}
              <p className="task-muted">
                {reported.length} of {filtered.length} attempts reported usage
              </p>
            </div>
          </div>
          <details className="supporting-details">
            <summary>What’s included</summary>
            <p>
              Reported attempts, including retries and follow-ups. Cached input is counted once.
              Missing and in-progress reports are excluded, not counted as zero. CLI account
              identity and separate subagent attribution are not yet available.
            </p>
          </details>
        </>
      )}
      {error && (
        <p role="alert" className="task-error">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading usage…</p>
      ) : !sorted.length ? (
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
      ) : (
        <div className="usage-table-scroll">
          <table className="usage-table">
            <caption className="sr-only">Usage for each execution attempt</caption>
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
                <tr key={run.id}>
                  <td>
                    <button
                      type="button"
                      className="task-link usage-task-link"
                      onClick={() => {
                        selectProject(run.projectId);
                        select(run.id);
                        onTask();
                      }}
                    >
                      {run.prompt}
                    </button>
                    <span className="task-muted text-xs block mt-1">
                      {run.projectName} · {new Date(run.startedAt).toLocaleDateString()}
                    </span>
                  </td>
                  <td>
                    {run.agent}
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
          </table>
        </div>
      )}
      <CapacityPanel />
    </section>
  );
}
