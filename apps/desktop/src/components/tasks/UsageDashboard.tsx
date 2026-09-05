import { Download } from 'lucide-react';
import { useState } from 'react';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
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
      <div className="flex justify-between items-start gap-5">
        <div>
          <p className="task-eyebrow">Understand the work</p>
          <h1 className="task-title">Usage</h1>
          <p className="task-muted mt-3">What your agents used, and where it went.</p>
        </div>
        <Button variant="outline" onClick={exportUsage} disabled={!filtered.length}>
          <Download size={14} />
          Export
        </Button>
      </div>
      <div className="usage-filters">
        <label>
          Project
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="all">All projects</option>
            {[...projectNames].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Period
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="all">All time</option>
          </select>
        </label>
        <label>
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="tokens">Tokens used</option>
            <option value="project">Project</option>
            <option value="agent">Agent</option>
            <option value="model">Model</option>
          </select>
        </label>
      </div>
      <div className="usage-overview">
        <div>
          <p className="task-label">Reported tokens</p>
          <p className="usage-total">{reported.length ? (input + output).toLocaleString() : '—'}</p>
        </div>
        <div className="task-muted text-sm">
          <p>
            {reported.length
              ? `${input.toLocaleString()} input · ${output.toLocaleString()} output`
              : 'No reported measurements yet'}
          </p>
          <p className="mt-2">
            {reported.length} of {filtered.length} attempts have a usage report
          </p>
        </div>
      </div>
      <p className="task-muted text-xs mb-7">
        Totals include reported attempts, including retries and follow-ups. Cached input is included
        once. Missing or in-progress reports are excluded, not counted as zero. CLI account identity
        and separate subagent attribution are not yet available.
      </p>
      {error && (
        <p role="alert" className="task-error">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading usage…</p>
      ) : !sorted.length ? (
        <div className="task-usage-empty">
          <h2 className="font-medium">Your first task starts the picture.</h2>
          <p className="task-muted mt-2">
            Reported usage will appear here when an agent returns it. No estimates or sample
            balances are filled in.
          </p>
        </div>
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
