import { Table, Tooltip } from '@jackalope/ui';
import { useMemo } from 'react';
import { agentNames } from '../../lib/agent-catalog';
import type { TaskRun } from '../../lib/run-types';
import { activityKind, takeaway, timeBreakdown, toolUse } from '../../lib/task-report';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import { ActivityTimeBar, ActivityTimeTable, percentLabel, timeLabel } from './ActivityTime';

const TOOLS_SHOWN = 10;

/** Where agents spent their working time across the attempts in the usage filters. */
export function UsageActivity({ runs }: { runs: TaskRun[] }) {
  const { time, agents, tools, note } = useMemo(() => {
    const time = timeBreakdown(runs);
    const measured = runs.filter((run) => Object.keys(run.efficiency?.activity ?? {}).length);
    const byAgent = new Map<string, TaskRun[]>();
    for (const run of measured) byAgent.set(run.agent, [...(byAgent.get(run.agent) ?? []), run]);
    return {
      time,
      note: takeaway(time),
      agents: [...byAgent]
        .map(([agent, agentRuns]) => ({
          agent,
          time: timeBreakdown(agentRuns),
          tasks: new Set(agentRuns.map((run) => run.taskId)).size,
        }))
        .filter((row) => row.time.measured)
        .sort((a, b) => b.time.workingMs - a.time.workingMs),
      tools: toolUse(measured).slice(0, TOOLS_SHOWN),
    };
  }, [runs]);
  if (!time.measured) return null;
  const longest = Math.max(...agents.map((row) => row.time.workingMs));
  return (
    <section className="workspace-section workspace-stack" aria-labelledby="usage-activity">
      <WorkspaceSectionHeading
        titleId="usage-activity"
        title="Where agent time goes"
        description={`${timeLabel(time.workingMs)} of agent working time across ${time.measuredAttempts.toLocaleString()} measured attempt${time.measuredAttempts === 1 ? '' : 's'}${time.measuredAttempts < time.attempts ? `; ${(time.attempts - time.measuredAttempts).toLocaleString()} earlier attempts ran before activity was timed` : ''}.`}
      />
      {note && <p className="activity-time-takeaway">{note}</p>}
      <ActivityTimeBar breakdown={time} label="Agent working time by activity" />
      {agents.length > 1 && (
        <Table className="usage-activity-agents" label="Agent working time by agent and activity">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Working time by activity</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((row) => (
              <tr key={row.agent}>
                <td>
                  {agentNames([row.agent])}
                  <small>
                    {row.tasks} task{row.tasks === 1 ? '' : 's'}
                  </small>
                </td>
                <td>
                  <span
                    className="usage-activity-row"
                    role="img"
                    aria-label={row.time.groups
                      .filter((group) => group.ms > 0)
                      .map((group) => `${group.label} ${percentLabel(group.share)}`)
                      .join(', ')}
                    style={{ width: `${Math.max(8, (row.time.workingMs / longest) * 100)}%` }}
                  >
                    {row.time.groups
                      .filter((group) => group.ms > 0)
                      .map((group) => (
                        <Tooltip
                          key={group.id}
                          content={
                            <span className="activity-time-tip">
                              <strong>{group.label}</strong>
                              {timeLabel(group.ms)} · {percentLabel(group.share)}
                            </span>
                          }
                        >
                          <span
                            className="activity-time-segment"
                            data-activity={group.id}
                            style={{ flexGrow: group.ms }}
                          />
                        </Tooltip>
                      ))}
                  </span>
                </td>
                <td>{timeLabel(row.time.workingMs)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="usage-activity-details">
        <section className="workspace-stack" aria-labelledby="usage-activity-kinds">
          <h3 id="usage-activity-kinds" className="usage-activity-heading">
            By activity
          </h3>
          <ActivityTimeTable breakdown={time} label="Agent working time by activity" />
        </section>
        {tools.length > 0 && (
          <section className="workspace-stack" aria-labelledby="usage-activity-tools">
            <h3 id="usage-activity-tools" className="usage-activity-heading">
              Slowest tools
            </h3>
            <Table className="usage-activity-tools" label="Tools by measured time">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Calls</th>
                  <th>Time</th>
                  <th>Average</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((tool) => (
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
                    </td>
                    <td>{tool.calls.toLocaleString()}</td>
                    <td>{tool.totalMs === null ? '—' : timeLabel(tool.totalMs)}</td>
                    <td>
                      {tool.totalMs === null || !tool.calls
                        ? '—'
                        : timeLabel(tool.totalMs / tool.calls)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </section>
        )}
      </div>
    </section>
  );
}
