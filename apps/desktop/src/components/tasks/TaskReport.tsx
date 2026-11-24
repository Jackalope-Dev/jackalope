import { statusLabel } from '@jackalope/contracts/runs';
import { Table } from '@jackalope/ui';
import { ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { agentNames } from '../../lib/agent-catalog';
import type { ChangeStats, TaskRun } from '../../lib/run-types';
import {
  activityKind,
  stageTotals,
  takeaway,
  timeBreakdown,
  toolUse,
  waitingMs,
} from '../../lib/task-report';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import { ActivityTimeBar, ActivityTimeTable, percentLabel, timeLabel } from './ActivityTime';
import './task-report.css';

const TOOLS_SHOWN = 12;
/** Where a finished task's time went across its attempts. */
export function TaskReport({ attempts, changes }: { attempts: TaskRun[]; changes?: ChangeStats }) {
  const report = useMemo(() => {
    const time = timeBreakdown(attempts);
    const usage = attempts.filter((run) => run.usage.reported);
    const costs = usage
      .map((run) => run.usage.estimatedCostUsd)
      .filter((cost): cost is number => cost != null);
    return {
      time,
      stages: stageTotals(attempts),
      waiting: waitingMs(attempts),
      tools: toolUse(attempts),
      note: takeaway(time),
      tokens: usage.length
        ? usage.reduce((sum, run) => sum + run.usage.input + run.usage.output, 0)
        : null,
      tokensPartial: usage.length < attempts.length,
      cost: costs.length ? costs.reduce((sum, cost) => sum + cost, 0) : null,
      checks: attempts.reduce(
        (sum, run) => ({
          runs: sum.runs + (run.efficiency?.verificationCalls ?? 0),
          failed: sum.failed + (run.efficiency?.verificationFailures ?? 0),
        }),
        { runs: 0, failed: 0 },
      ),
    };
  }, [attempts]);
  const { time, stages } = report;
  const facts = [
    { label: 'Agent working', value: timeLabel(stages.agentMs), shown: stages.agentMs > 0 },
    {
      label: 'Saved checks',
      value: timeLabel(stages.checkMs),
      detail: report.checks.runs
        ? `${report.checks.runs} run${report.checks.runs === 1 ? '' : 's'}${report.checks.failed ? `, ${report.checks.failed} failed` : ''}`
        : undefined,
      shown: stages.checkMs > 0 || report.checks.runs > 0,
    },
    { label: 'Setup', value: timeLabel(stages.setupMs), shown: stages.setupMs >= 1000 },
    { label: 'Waited on you', value: timeLabel(report.waiting), shown: report.waiting >= 1000 },
    {
      label: 'Tokens',
      value:
        report.tokens === null
          ? 'Not reported'
          : Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
              report.tokens,
            ),
      detail:
        report.tokens !== null && report.tokensPartial ? 'Some attempts unreported' : undefined,
      shown: true,
    },
    {
      label: 'Reported cost',
      value: `$${(report.cost ?? 0).toFixed(2)}`,
      shown: report.cost !== null,
    },
    {
      label: 'Changes',
      value: changes ? `${changes.files} file${changes.files === 1 ? '' : 's'}` : '',
      detail: changes
        ? `+${changes.added.toLocaleString()} −${changes.removed.toLocaleString()}`
        : undefined,
      shown: !!changes?.files,
    },
  ].filter((fact) => fact.shown);
  const shownTools = report.tools.slice(0, TOOLS_SHOWN);
  const hiddenTools = report.tools.slice(TOOLS_SHOWN);
  return (
    <div className="task-report workspace-sections">
      <section className="task-report-summary" aria-label="Task summary">
        <div className="task-report-total">
          <span>Start to finish</span>
          <strong>{timeLabel(stages.elapsedMs)}</strong>
          <small>
            {attempts.length === 1 ? 'One attempt' : `${attempts.length} attempts`} ·{' '}
            {agentNames([...new Set(attempts.map((run) => run.agent))], 'and')}
          </small>
        </div>
        <dl className="task-report-facts">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>
                {fact.value}
                {fact.detail && <small>{fact.detail}</small>}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="workspace-section workspace-stack" aria-labelledby="task-report-time">
        <WorkspaceSectionHeading titleId="task-report-time" title="Where the agent's time went" />
        {time.measured ? (
          <>
            {report.note && <p className="activity-time-takeaway">{report.note}</p>}
            <ActivityTimeBar breakdown={time} label="Agent working time by activity" />
            <ActivityTimeTable breakdown={time} label="Agent working time by activity" />
            {time.measuredAttempts < time.attempts && (
              <p className="task-muted">
                Measured on {time.measuredAttempts} of {time.attempts} attempts. Earlier attempts
                ran before Jackalope timed each activity.
              </p>
            )}
          </>
        ) : (
          <p className="task-muted">
            This task ran before Jackalope timed each activity. Tasks you start from now on show how
            long the agent spent reading, testing, trying the app and writing.
          </p>
        )}
      </section>

      {report.tools.length > 0 && (
        <section className="workspace-section workspace-stack" aria-labelledby="task-report-tools">
          <WorkspaceSectionHeading titleId="task-report-tools" title="Tools" />
          <Table className="task-report-tools" label="Tools the agents called">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Calls</th>
                <th>Time</th>
                <th>Longest</th>
              </tr>
            </thead>
            <tbody>
              {shownTools.map((tool) => (
                <tr key={tool.name}>
                  <td>
                    <span className="activity-time-tool">
                      <span
                        className="activity-time-swatch"
                        data-activity={tool.kind ? activityKind(tool.kind).group : undefined}
                        aria-hidden="true"
                      />
                      <span title={tool.name}>{tool.label}</span>
                    </span>
                    {tool.kind && <small>{activityKind(tool.kind).label}</small>}
                  </td>
                  <td>{tool.calls.toLocaleString()}</td>
                  <td>{tool.totalMs === null ? '—' : timeLabel(tool.totalMs)}</td>
                  <td>{tool.longestMs ? timeLabel(tool.longestMs) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          {hiddenTools.length > 0 && (
            <p className="task-muted">
              {hiddenTools.length} more tool{hiddenTools.length === 1 ? '' : 's'} with{' '}
              {hiddenTools.reduce((sum, tool) => sum + tool.calls, 0).toLocaleString()} calls.
            </p>
          )}
        </section>
      )}

      {attempts.length > 1 && (
        <section
          className="workspace-section workspace-stack"
          aria-labelledby="task-report-attempts"
        >
          <WorkspaceSectionHeading titleId="task-report-attempts" title="Attempts" />
          <Table label="Each attempt at this task">
            <thead>
              <tr>
                <th>Attempt</th>
                <th>Agent</th>
                <th>Duration</th>
                <th>Tokens</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((run, index) => {
                const totals = stageTotals([run]);
                return (
                  <tr key={run.id}>
                    <td>{index + 1}</td>
                    <td>
                      {agentNames([run.agent])}
                      {run.model && <small>{run.model}</small>}
                    </td>
                    <td>{totals.elapsedMs ? timeLabel(totals.elapsedMs) : '—'}</td>
                    <td>
                      {run.usage.reported
                        ? (run.usage.input + run.usage.output).toLocaleString()
                        : 'Not reported'}
                    </td>
                    <td>{statusLabel[run.status]}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </section>
      )}
    </div>
  );
}

/** A one-line pointer from the result to its report. */
export function TaskReportLink({ attempts, onOpen }: { attempts: TaskRun[]; onOpen: () => void }) {
  const { time, elapsed } = useMemo(
    () => ({ time: timeBreakdown(attempts), elapsed: stageTotals(attempts).elapsedMs }),
    [attempts],
  );
  if (!elapsed) return null;
  const top = time.measured
    ? [...time.groups].sort((a, b) => b.ms - a.ms).find((group) => group.ms > 0)
    : undefined;
  return (
    <button type="button" className="task-report-link" onClick={onOpen}>
      <span className="task-report-link-time">Took {timeLabel(elapsed)}</span>
      {time.measured && (
        <span className="task-report-link-bar" aria-hidden="true">
          {time.groups
            .filter((group) => group.ms > 0)
            .map((group) => (
              <span key={group.id} data-activity={group.id} style={{ flexGrow: group.ms }} />
            ))}
        </span>
      )}
      {top && (
        <span className="task-report-link-detail">
          Mostly {top.label.toLowerCase()} ({percentLabel(top.share)})
        </span>
      )}
      <span className="task-report-link-action">
        View report
        <ChevronRight size={16} aria-hidden="true" />
      </span>
    </button>
  );
}
