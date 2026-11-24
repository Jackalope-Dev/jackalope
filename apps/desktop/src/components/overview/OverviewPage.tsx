import { Button, EmptyState, LinkButton } from '@jackalope/ui';
import {
  ArrowRight,
  CircleCheck,
  CircleX,
  FolderPlus,
  GitBranch,
  GitPullRequest,
  LayoutDashboard,
  MonitorPlay,
  Plus,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { navigateWorkspace } from '../../lib/app-events';
import {
  capacityAgentName,
  capacityWindowDisplay,
  capacityWindowName,
  shortAccount,
} from '../../lib/capacity-display';
import { liveWork } from '../../lib/live-work';
import { isTauriEnvironment } from '../../lib/native/env';
import { pullRequestPhaseView } from '../../lib/pull-requests';
import type { WorkItem } from '../../lib/task-collection';
import {
  openWork,
  selectWork,
  useAllRuns,
  useWorkspaceWork,
  workProjectId,
} from '../../lib/work-selection';
import { compactElapsed } from '../../lib/work-signals';
import {
  finishedOutcome,
  type ProjectSummary,
  projectSummaries,
  recentlyFinished,
  workActivityTime,
} from '../../lib/workspace-overview';
import { useActivityStore } from '../../stores/activityStore';
import {
  type CapacityRecord,
  type CapacityWindow,
  useCapacityStore,
} from '../../stores/capacityStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { isGeneralProject, type Project, useProjectStore } from '../../stores/projectStore';
import { usePullRequestStore } from '../../stores/pullRequestStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { ProviderMark } from '../agents/ProviderMark';
import { ProjectMark } from '../projects/ProjectMark';
import { ActionError } from '../ui/ActionError';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { LiveWorkRow } from './LiveWorkRow';
import './overview.css';

const FINISHED_LIMIT = 6;

function ago(time: string | undefined, now: number) {
  if (!time) return '';
  const elapsed = compactElapsed(time, now);
  return elapsed === '<1m' ? 'just now' : elapsed ? `${elapsed} ago` : '';
}

function openProject(project: Project) {
  selectWork();
  useProjectStore.getState().selectProject(project.id);
  useWorkViewStore.getState().setScope('project');
  navigateWorkspace('kanban');
}

function showItem(item: WorkItem, section?: string) {
  openWork(item);
  if (section && item.run && !item.session && !item.managed)
    useWorkViewStore.getState().open(item.run.id, section);
  navigateWorkspace('kanban');
}

function SectionTitle({ id, title, count }: { id: string; title: string; count?: number }) {
  return (
    <h2 id={id} className="overview-section-title">
      {title}
      {count !== undefined && <span className="overview-count">{count}</span>}
    </h2>
  );
}

/** Open counts in the order they ask for attention; zero counts are left out. */
const COUNTS = [
  { key: 'needsYou', label: (n: number) => `${n} ${n === 1 ? 'needs' : 'need'} you` },
  { key: 'reviewReady', label: (n: number) => `${n} to review` },
  { key: 'running', label: (n: number) => `${n} running` },
  { key: 'drafts', label: (n: number) => `${n} ${n === 1 ? 'draft' : 'drafts'}` },
] as const;

function ProjectCard({ summary, now }: { summary: ProjectSummary; now: number }) {
  const { project, lastCheck } = summary;
  const facts: ReactNode[] = [];
  for (const { pullRequest, item } of summary.pullRequests) {
    const phase = pullRequestPhaseView(pullRequest.phase);
    const detail =
      pullRequest.phase === 'failing' && pullRequest.failing.length
        ? pullRequest.failing.slice(0, 2).join(', ')
        : pullRequest.phase === 'checking' && pullRequest.pending
          ? `${pullRequest.pending} of ${pullRequest.checks} checks running`
          : '';
    facts.push(
      <li key={pullRequest.url} data-tone={phase.tone}>
        <button
          type="button"
          disabled={!item}
          onClick={() => item && showItem(item, 'delivery')}
          title={pullRequest.error ? `Last read failed: ${pullRequest.error}` : undefined}
        >
          <GitPullRequest size={14} aria-hidden="true" />
          <span className="overview-fact-text">
            {pullRequest.number ? `#${pullRequest.number} ` : ''}
            {phase.label}
            {detail ? ` · ${detail}` : ''}
          </span>
        </button>
      </li>,
    );
  }
  if (lastCheck)
    facts.push(
      <li key="check" data-tone={lastCheck.success ? 'success' : 'warning'}>
        <button
          type="button"
          disabled={!lastCheck.item}
          onClick={() => lastCheck.item && showItem(lastCheck.item, 'verify')}
        >
          {lastCheck.success ? (
            <CircleCheck size={14} aria-hidden="true" />
          ) : (
            <CircleX size={14} aria-hidden="true" />
          )}
          <span className="overview-fact-text">
            {lastCheck.success ? 'Checks passed' : 'Checks failed'}
            {lastCheck.command ? ` · ${lastCheck.command}` : ''} · {ago(lastCheck.at, now)}
          </span>
        </button>
      </li>,
    );
  for (const preview of summary.previews)
    facts.push(
      <li key={preview.runId}>
        <button
          type="button"
          onClick={() => {
            useWorkViewStore.getState().open(preview.runId, 'preview');
            navigateWorkspace('kanban');
          }}
        >
          <MonitorPlay size={14} aria-hidden="true" />
          <span className="overview-fact-text">
            Preview on port {preview.port}
            {preview.item ? ` · ${preview.item.title}` : ''}
          </span>
        </button>
      </li>,
    );
  return (
    <li className="overview-project" aria-labelledby={`overview-project-${project.id}`}>
      <div className="overview-project-head">
        <button
          type="button"
          className="overview-project-open"
          onClick={() => openProject(project)}
          id={`overview-project-${project.id}`}
        >
          <ProjectMark project={project} />
          <span className="overview-project-name">{project.name}</span>
          <ArrowRight size={14} aria-hidden="true" />
        </button>
        {summary.targetBranch && (
          <span className="overview-branch" title="Finished work merges into this branch">
            <GitBranch size={12} aria-hidden="true" />
            {summary.targetBranch}
          </span>
        )}
      </div>
      {COUNTS.some(({ key }) => summary[key] > 0) ? (
        <ul className="overview-counts" aria-label="Open work">
          {COUNTS.filter(({ key }) => summary[key] > 0).map(({ key, label }) => (
            <li key={key} data-key={key}>
              {label(summary[key])}
            </li>
          ))}
        </ul>
      ) : (
        <p className="overview-counts-none">Nothing open</p>
      )}
      {facts.length > 0 && <ul className="overview-facts">{facts}</ul>}
      <p className="overview-project-foot">
        {summary.lastActivity ? `Last activity ${ago(summary.lastActivity, now)}` : 'No work yet'}
      </p>
    </li>
  );
}

interface LimitRow {
  record: CapacityRecord;
  window: CapacityWindow;
  remaining: number;
  label: string;
  tone: 'low' | 'empty';
}

/**
 * An account window at or near its limit. `reset` is the slot for when the limit lifts;
 * it renders only when given.
 */
function UsageRow({ row, reset }: { row: LimitRow; reset?: ReactNode }) {
  return (
    <li className="overview-usage-row" data-tone={row.tone}>
      <span className="overview-usage-mark" aria-hidden="true">
        <ProviderMark provider={row.record.agent} size={18} />
      </span>
      <span className="overview-usage-text">
        <span className="overview-usage-name">
          {capacityAgentName(row.record.agent)}
          <span className="overview-usage-account" title={row.record.account}>
            {' '}
            · {shortAccount(row.record.account)}
          </span>
        </span>
        <span className="overview-usage-detail">
          {row.tone === 'empty' ? 'Limit reached' : row.label} ·{' '}
          {capacityWindowName(row.window).toLowerCase()}
        </span>
        {reset && <span className="overview-usage-reset">{reset}</span>}
      </span>
      <span className="overview-usage-bar" aria-hidden="true">
        <span className="overview-usage-fill" style={{ width: `${Math.max(row.remaining, 0)}%` }} />
      </span>
    </li>
  );
}

function UsageGlance({ now }: { now: number }) {
  const records = useCapacityStore((state) => state.records);
  const error = useCapacityStore((state) => state.error);
  const rows = useMemo(
    () =>
      records
        .filter((record) => record.status !== 'notInstalled')
        .flatMap((record) =>
          record.windows.flatMap((window): LimitRow[] => {
            const display = capacityWindowDisplay(record, window, now);
            return (display.tone === 'low' || display.tone === 'empty') &&
              display.remaining !== null
              ? [
                  {
                    record,
                    window,
                    remaining: display.remaining,
                    label: display.label,
                    tone: display.tone,
                  },
                ]
              : [];
          }),
        )
        .sort((a, b) => a.remaining - b.remaining),
    [records, now],
  );
  return (
    <section className="overview-section" aria-labelledby="overview-usage">
      <div className="overview-section-heading">
        <SectionTitle id="overview-usage" title="Usage at a glance" />
        <LinkButton onClick={() => navigateWorkspace('usage')}>View usage</LinkButton>
      </div>
      <div className="overview-panel">
        <ActionError error={error} />
        {rows.length ? (
          <ul className="overview-usage">
            {rows.map((row) => (
              <UsageRow
                key={`${row.record.agent}:${row.record.account}:${row.window.window}`}
                row={row}
              />
            ))}
          </ul>
        ) : (
          <p className="overview-quiet">
            {!isTauriEnvironment()
              ? 'Account limits are available in the desktop app.'
              : records.length
                ? 'No account is near its limit.'
                : 'No account limits reported yet.'}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Overview: a calm read of everything at once. Running work, each project's state, accounts
 * near their limits and what just finished, all derived from the stores the app already
 * keeps current; nothing here polls on its own.
 */
export function OverviewPage({
  onNewWork,
  onAddProject,
}: {
  onNewWork: () => void;
  onAddProject: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const fetchCapacity = useCapacityStore((state) => state.fetch);
  useEffect(() => {
    void fetchCapacity();
  }, [fetchCapacity]);

  const projects = useProjectStore((state) => state.projects);
  const items = useWorkspaceWork();
  const runs = useAllRuns();
  const sessions = useLiveSessionStore((state) => state.sessions);
  const queue = useManagedTaskStore((state) => state.queue);
  const pullRequests = usePullRequestStore((state) => state.tracked);
  const schedules = useActivityStore((state) => state.schedules);
  const previews = useActivityStore((state) => state.previews);
  const previewError = useActivityStore((state) => state.previewError);

  const live = useMemo(
    () => liveWork({ items, runs, sessions, queue, schedules }),
    [items, runs, sessions, queue, schedules],
  );
  // Previews start and stop with the work around them, so re-read them when that changes.
  const liveKey = live.map((entry) => entry.key).join();
  useEffect(() => {
    void liveKey;
    void useActivityStore.getState().refreshPreviews();
  }, [liveKey]);

  // General holds work without a project; it earns a card only once it has some.
  const summaries = useMemo(
    () =>
      projectSummaries({ projects, items, live, runs, pullRequests, previews }).filter(
        (entry) => !isGeneralProject(entry.project) || entry.lastActivity || entry.drafts,
      ),
    [projects, items, live, runs, pullRequests, previews],
  );
  const finished = useMemo(() => recentlyFinished(items, FINISHED_LIMIT), [items]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  if (!summaries.length)
    return (
      <WorkspacePage className="overview-page" aria-labelledby="overview-title">
        <WorkspaceHeading title={<span id="overview-title">Overview</span>} />
        <EmptyState
          icon={LayoutDashboard}
          title="Add a project to get started"
          description="Once a project is added, this page shows what is running, what needs you and how each project stands."
          action={
            <Button onClick={onAddProject}>
              <FolderPlus size={16} aria-hidden="true" />
              Add a project
            </Button>
          }
        />
      </WorkspacePage>
    );

  const waiting = live.filter((entry) => entry.waiting).length;
  const needsYou = summaries.reduce((sum, summary) => sum + summary.needsYou, 0);
  const summary = [
    `${live.length - waiting} running`,
    waiting ? `${waiting} waiting on you` : '',
    needsYou ? `${needsYou} ${needsYou === 1 ? 'needs' : 'need'} you` : '',
    `${summaries.length} ${summaries.length === 1 ? 'project' : 'projects'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <WorkspacePage className="overview-page" aria-labelledby="overview-title">
      <WorkspaceHeading
        title={<span id="overview-title">Overview</span>}
        description={summary}
        action={
          <Button onClick={onNewWork}>
            <Plus size={16} aria-hidden="true" />
            New work
          </Button>
        }
      />
      <div className="overview-layout">
        <div className="overview-main">
          <section className="overview-section" aria-labelledby="overview-running">
            <SectionTitle id="overview-running" title="Running now" count={live.length} />
            <div className="overview-panel">
              {live.length ? (
                <ul className="overview-live">
                  {live.map((entry) => (
                    <LiveWorkRow
                      key={entry.key}
                      entry={entry}
                      project={entry.projectId ? projectById.get(entry.projectId) : undefined}
                      now={now}
                    />
                  ))}
                </ul>
              ) : (
                <p className="overview-quiet">
                  Nothing is running. Work you start, scheduled runs and checks show here while they
                  run.
                </p>
              )}
            </div>
          </section>
          <section className="overview-section" aria-labelledby="overview-projects">
            <SectionTitle id="overview-projects" title="Projects" count={summaries.length} />
            <ActionError
              error={previewError && `Could not read running previews: ${previewError}`}
            />
            <ul className="overview-projects">
              {summaries.map((entry) => (
                <ProjectCard key={entry.project.id} summary={entry} now={now} />
              ))}
            </ul>
          </section>
        </div>
        <div className="overview-side">
          <UsageGlance now={now} />
          <section className="overview-section" aria-labelledby="overview-finished">
            <SectionTitle id="overview-finished" title="Recently finished" />
            <div className="overview-panel">
              {finished.length ? (
                <ul className="overview-finished">
                  {finished.map((item) => {
                    const projectId = workProjectId(item);
                    const project = projectId ? projectById.get(projectId) : undefined;
                    return (
                      <li key={item.id}>
                        <button type="button" onClick={() => showItem(item)}>
                          <span className="overview-finished-title">{item.title}</span>
                          <span className="overview-finished-meta">
                            {finishedOutcome(item, queue.mergedRunIds)}
                            {project ? ` · ${project.name}` : ''}
                            {` · ${ago(workActivityTime(item), now)}`}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="overview-quiet">Finished and merged work shows here.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </WorkspacePage>
  );
}
