import { Badge, Button, LinkButton, SegmentedControl, Select, SelectItem } from '@jackalope/ui';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCheck,
  CheckCircle2,
  CircleAlert,
  GitPullRequest,
  LifeBuoy,
  type LucideIcon,
  MessageCircleQuestion,
  PauseCircle,
  Plus,
  Sparkles,
  StopCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { navigateWorkspace } from '../../lib/app-events';
import { buildCatchUp, type CatchUpDecision, catchUpHeadline } from '../../lib/catch-up';
import { liveWork } from '../../lib/live-work';
import { pullRequestPhaseView } from '../../lib/pull-requests';
import { type WorkItem, workPresence } from '../../lib/task-collection';
import { openWork, useAllRuns, useWorkspaceWork, workProjectId } from '../../lib/work-selection';
import { compactElapsed, signalKey } from '../../lib/work-signals';
import { useActivityStore } from '../../stores/activityStore';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useCapacityStore } from '../../stores/capacityStore';
import { type CompanionNotice, sortNotices, useCompanionStore } from '../../stores/companionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { isAgentAllowedForProject, type Project, useProjectStore } from '../../stores/projectStore';
import { useChangeStats, useWorkSignalsStore } from '../../stores/workSignalsStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { AgentStack } from '../agents/AgentAvatar';
import { LiveWorkRow } from '../overview/LiveWorkRow';
import { ProjectMark } from '../projects/ProjectMark';
import { Picture } from '../tasks/WorkCatchUp';
import { WorkspacePage } from '../ui/WorkspacePage';
import { allowanceAlerts, companionAlerts } from './inbox-alerts';
import './inbox.css';

/** Results from the last few days that the person has not opened yet. */
const RECENT_MS = 3 * 24 * 60 * 60_000;
const PICTURE_LIMIT = 4;
/** Running rows the rail lists before pointing at Overview for the rest. */
const RUNNING_LIMIT = 5;

type Kind = 'all' | 'needs' | 'alerts' | 'activity';

const decisionKinds: Record<
  CatchUpDecision['kind'],
  { label: string; icon: LucideIcon; tone: 'accent' | 'warning' | 'success' }
> = {
  question: { label: 'Question', icon: MessageCircleQuestion, tone: 'accent' },
  review: { label: 'Ready to review', icon: CheckCheck, tone: 'success' },
  'failed-check': { label: 'Check failed', icon: AlertTriangle, tone: 'warning' },
  recovery: { label: 'Needs recovery', icon: LifeBuoy, tone: 'warning' },
  stopped: { label: 'Stopped', icon: StopCircle, tone: 'warning' },
  paused: { label: 'Paused', icon: PauseCircle, tone: 'accent' },
  other: { label: 'Needs you', icon: CircleAlert, tone: 'accent' },
};

const riskBadge = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
  unknown: 'outline',
} as const;
const riskLabel = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
  unknown: 'Risk unknown',
} as const;

const alertIcon: Record<CompanionNotice['kind'], LucideIcon> = {
  attention: CircleAlert,
  success: Sparkles,
  info: Bell,
};

function greeting(now: Date) {
  const hour = now.getHours();
  return hour < 5
    ? 'Working late'
    : hour < 12
      ? 'Good morning'
      : hour < 18
        ? 'Good afternoon'
        : 'Good evening';
}

/** When the item last produced something: a finished run, a conversation reply or its date. */
function activityTime(item: WorkItem) {
  return item.run?.endedAt ?? item.session?.updatedAt ?? item.date;
}

function ago(time: string | undefined, now: number) {
  if (!time) return '';
  const elapsed = compactElapsed(time, now);
  return elapsed ? (elapsed === '<1m' ? 'just now' : `${elapsed} ago`) : '';
}

function ProjectTag({ project }: { project?: Project }) {
  if (!project) return null;
  return (
    <span className="inbox-project">
      <ProjectMark project={project} />
      <span>{project.name}</span>
    </span>
  );
}

function DecisionCard({
  decision,
  project,
  now,
}: {
  decision: CatchUpDecision;
  project?: Project;
  now: number;
}) {
  const kind = decisionKinds[decision.kind];
  const KindIcon = kind.icon;
  const presence = workPresence(decision.item);
  return (
    <li className="inbox-decision" data-tone={kind.tone}>
      <div className="inbox-decision-meta">
        <span className="inbox-kind">
          <KindIcon size={14} aria-hidden="true" />
          {kind.label}
        </span>
        <ProjectTag project={project} />
        <time dateTime={activityTime(decision.item)}>{ago(activityTime(decision.item), now)}</time>
      </div>
      <div className="inbox-decision-body">
        <AgentStack agents={presence.agents} state={presence.state} size="md" />
        <div>
          <h3>{decision.title}</h3>
          <p className="inbox-decision-call">{decision.decision}</p>
          <p className="inbox-decision-facts">
            <span>{decision.changes}</span>
            {decision.evidence.length > 0 && <span>{decision.evidence.join(' · ')}</span>}
          </p>
          {decision.suggestion && (
            <p className="inbox-suggestion">
              <Sparkles size={14} aria-hidden="true" />
              {decision.suggestion}
            </p>
          )}
        </div>
      </div>
      <div className="inbox-decision-actions">
        <span className="inbox-risk">
          <Badge variant={riskBadge[decision.risk.level]}>{riskLabel[decision.risk.level]}</Badge>
          <span>{decision.risk.reason}</span>
        </span>
        <Button variant="secondary" onClick={() => openWork(decision.item)}>
          {decision.action}
          <ArrowRight size={14} aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

function AlertRow({
  notice,
  unread,
  onRead,
}: {
  notice: CompanionNotice;
  unread: boolean;
  onRead: () => void;
}) {
  const Icon = alertIcon[notice.kind];
  return (
    <li className="inbox-alert" data-kind={notice.kind} data-unread={unread || undefined}>
      <span className="inbox-alert-icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <div className="inbox-alert-text">
        <p className="inbox-alert-title">
          {notice.title}
          {unread && <Badge variant="accent">New</Badge>}
        </p>
        {notice.detail && <p className="inbox-alert-detail">{notice.detail}</p>}
        {(notice.onOpen || notice.onDismiss) && (
          <div className="inbox-alert-actions">
            {notice.onOpen && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onRead();
                  notice.onOpen?.();
                }}
              >
                {notice.actionLabel ?? 'Open'}
              </Button>
            )}
            {notice.onDismiss && (
              <Button size="sm" variant="ghost" onClick={notice.onDismiss}>
                Dismiss
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function WorkRow({ item, project, detail }: { item: WorkItem; project?: Project; detail: string }) {
  const presence = workPresence(item);
  return (
    <li>
      <button type="button" className="inbox-work-row" onClick={() => openWork(item)}>
        <AgentStack agents={presence.agents} state={presence.state} />
        <span className="inbox-work-text">
          <span className="inbox-work-title">{item.title}</span>
          <span className="inbox-work-detail">
            {project && (
              <span className="inbox-work-project">
                <ProjectMark project={project} />
                {project.name}
              </span>
            )}
            {detail}
          </span>
        </span>
        <ArrowRight size={14} aria-hidden="true" className="inbox-work-arrow" />
      </button>
    </li>
  );
}

/**
 * Inbox: one place for everything waiting on the person across projects. Decisions come
 * from recorded work (questions, failed checks, results to review), alerts from the app's
 * own notices and account allowances, and activity from running and recently finished
 * work. Nothing here is synthesised; empty sections are simply left out.
 */
export function InboxPage({ onNewWork }: { onNewWork: () => void }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  // Needs-you work is listed here, so the companion does not pop up about it too.
  useEffect(() => {
    useCompanionStore.getState().setOnWorkList(true);
    return () => useCompanionStore.getState().setOnWorkList(false);
  }, []);
  const fetchCapacity = useCapacityStore((state) => state.fetch);
  useEffect(() => {
    void fetchCapacity();
  }, [fetchCapacity]);

  const [kind, setKind] = useState<Kind>('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const projects = useProjectStore((state) => state.projects);
  const allWork = useWorkspaceWork();
  const queue = useManagedTaskStore((state) => state.queue);
  const seen = useWorkSignalsStore((state) => state.seen);
  const signalsSince = useWorkSignalsStore((state) => state.since);
  const allRuns = useAllRuns();
  const sources = useCompanionStore((state) => state.sources);
  const readIds = useCompanionStore((state) => state.readIds);
  const records = useCapacityStore((state) => state.records);
  const sessions = useLiveSessionStore((state) => state.sessions);
  const schedules = useActivityStore((state) => state.schedules);
  const enabledAgents = useAgentConfigStore((state) => state.enabledAgents);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const projectOf = (item: WorkItem) => {
    const id = workProjectId(item);
    return id ? projectById.get(id) : undefined;
  };
  const work = useMemo(
    () =>
      projectFilter === 'all'
        ? allWork
        : allWork.filter((item) => workProjectId(item) === projectFilter),
    [allWork, projectFilter],
  );

  const waitingRuns = work
    .filter((item) => item.stage === 'attention' || item.stage === 'review')
    .map((item) => item.run);
  const stats = useChangeStats(waitingRuns);
  const changedFiles = useMemo(
    () => Object.fromEntries(Object.entries(stats).map(([id, entry]) => [id, entry.value.files])),
    [stats],
  );
  const since = useMemo(() => {
    return new Date(Math.max(Date.parse(signalsSince) || 0, now - RECENT_MS)).toISOString();
  }, [now, signalsSince]);
  // The catch-up summary is empty unless something is new; reading it from the start of
  // time lists every decision still waiting, and the recent window gives unread results.
  const catchUp = useMemo(() => {
    const input = {
      items: work,
      runs: allRuns,
      queue,
      seen,
      changedFiles,
      actionFor: (item: WorkItem) => workPresence(item).action,
    };
    return {
      waiting: buildCatchUp({ ...input, since: '' })?.waiting ?? [],
      recent: buildCatchUp({ ...input, since }),
    };
  }, [work, allRuns, queue, since, seen, changedFiles]);
  const decisions = catchUp.waiting;
  const happened = catchUp.recent?.happened ?? [];
  const moreHappened = catchUp.recent?.moreHappened ?? 0;
  // Running work waiting on an answer is listed under Needs you instead.
  const running = useMemo(
    () =>
      liveWork({ items: allWork, runs: allRuns, sessions, queue, schedules }).filter(
        (entry) => !entry.waiting && (projectFilter === 'all' || entry.projectId === projectFilter),
      ),
    [allWork, allRuns, sessions, queue, schedules, projectFilter],
  );
  const othersTurn = work.filter((item) => item.stage === 'inReview');

  const alerts = useMemo(() => {
    const enabled = (agent: string) =>
      (enabledAgents[agent] ?? true) &&
      (projectFilter === 'all' || isAgentAllowedForProject(projectById.get(projectFilter), agent));
    return sortNotices([
      ...companionAlerts(sources),
      ...allowanceAlerts(records, enabled, now, () => navigateWorkspace('usage')),
    ]);
  }, [sources, records, enabledAgents, projectFilter, projectById, now]);
  const unreadAlerts = alerts.filter((notice) => !readIds.includes(notice.id));
  const markAlertsRead = (ids: string[]) => useCompanionStore.getState().markRead(ids);
  const markResultsRead = () => {
    const { markSeen } = useWorkSignalsStore.getState();
    for (const event of happened) markSeen(signalKey(event.item), false);
  };

  const show = (section: Exclude<Kind, 'all'>) => kind === 'all' || kind === section;
  const activityCount = running.length + othersTurn.length + happened.length;
  const caughtUp = decisions.length === 0 && unreadAlerts.length === 0;
  const today = new Date(now);
  const scopeName = projectFilter === 'all' ? '' : projectById.get(projectFilter)?.name;
  const headline = caughtUp
    ? `You're all caught up${scopeName ? ` in ${scopeName}` : ''}.`
    : [
        decisions.length ? catchUpHeadline(decisions) : '',
        unreadAlerts.length
          ? `${unreadAlerts.length} new ${unreadAlerts.length === 1 ? 'alert' : 'alerts'}.`
          : '',
      ]
        .filter(Boolean)
        .join(' ');
  const pictures = happened.filter((event) => event.picture).slice(0, PICTURE_LIMIT);

  const needsSection = show('needs') && decisions.length > 0 && (
    <section className="inbox-section" aria-labelledby="inbox-needs">
      <h2 id="inbox-needs" className="inbox-section-title">
        Needs you <span className="inbox-count">{decisions.length}</span>
      </h2>
      <ol className="inbox-decisions">
        {decisions.map((decision) => (
          <DecisionCard
            key={decision.item.id}
            decision={decision}
            project={projectOf(decision.item)}
            now={now}
          />
        ))}
      </ol>
    </section>
  );

  const resultsSection = show('activity') && happened.length > 0 && (
    <section className="inbox-section" aria-labelledby="inbox-results">
      <div className="inbox-section-heading">
        <h2 id="inbox-results" className="inbox-section-title">
          New results <span className="inbox-count">{happened.length}</span>
        </h2>
        <Button size="sm" variant="ghost" onClick={markResultsRead}>
          Mark all read
        </Button>
      </div>
      {pictures.length > 0 && (
        <div className="inbox-pictures catch-up-pictures">
          {pictures.map((event) =>
            event.picture ? (
              <Picture
                key={event.item.id}
                picture={event.picture}
                title={event.title}
                onOpen={() => openWork(event.item)}
              />
            ) : null,
          )}
        </div>
      )}
      <ol className="inbox-timeline">
        {happened.map((event) => (
          <li key={event.item.id} data-tone={event.tone}>
            <button type="button" onClick={() => openWork(event.item)}>
              <span className="inbox-timeline-line">
                <strong>{event.title}</strong>
                <time dateTime={activityTime(event.item)}>
                  {ago(activityTime(event.item), now)}
                </time>
              </span>
              <span className="inbox-timeline-outcome">
                {/[.!?…]$/.test(event.outcome) ? event.outcome : `${event.outcome}.`}
                {event.detail ? ` ${event.detail}` : ''}
              </span>
              <ProjectTag project={projectOf(event.item)} />
            </button>
          </li>
        ))}
      </ol>
      {moreHappened > 0 && (
        <p className="inbox-note">
          {moreHappened} more in{' '}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => useWorkViewStore.getState().setScope('all')}
          >
            All work
          </Button>
        </p>
      )}
    </section>
  );

  const alertsSection = show('alerts') && alerts.length > 0 && (
    <section className="inbox-section" aria-labelledby="inbox-alerts">
      <div className="inbox-section-heading">
        <h2 id="inbox-alerts" className="inbox-section-title">
          Alerts <span className="inbox-count">{alerts.length}</span>
        </h2>
        {unreadAlerts.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => markAlertsRead(unreadAlerts.map((notice) => notice.id))}
          >
            Mark all read
          </Button>
        )}
      </div>
      <div className="inbox-panel">
        <ul className="inbox-alerts">
          {alerts.map((notice) => (
            <AlertRow
              key={notice.id}
              notice={notice}
              unread={!readIds.includes(notice.id)}
              onRead={() => markAlertsRead([notice.id])}
            />
          ))}
        </ul>
      </div>
    </section>
  );

  const moreRunning = running.length - RUNNING_LIMIT;
  const runningSection = show('activity') && (
    <section className="inbox-section" aria-labelledby="inbox-running">
      <h2 id="inbox-running" className="inbox-section-title">
        Running now <span className="inbox-count">{running.length}</span>
      </h2>
      <div className="inbox-panel">
        {running.length > 0 ? (
          <ul className="inbox-work">
            {running.slice(0, RUNNING_LIMIT).map((entry) => (
              <LiveWorkRow
                key={entry.key}
                entry={entry}
                project={entry.projectId ? projectById.get(entry.projectId) : undefined}
                now={now}
                compact
              />
            ))}
          </ul>
        ) : (
          <p className="inbox-panel-quiet">Nothing is running right now.</p>
        )}
        <button
          type="button"
          className="inbox-panel-more"
          onClick={() => navigateWorkspace('overview')}
        >
          <span>{moreRunning > 0 ? `${moreRunning} more running` : 'See overview'}</span>
          {moreRunning > 0 && <span className="inbox-panel-more-hint">See overview</span>}
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
    </section>
  );

  const othersSection = show('activity') && othersTurn.length > 0 && (
    <section className="inbox-section" aria-labelledby="inbox-others">
      <h2 id="inbox-others" className="inbox-section-title">
        <GitPullRequest size={16} aria-hidden="true" />
        Waiting on others <span className="inbox-count">{othersTurn.length}</span>
      </h2>
      <div className="inbox-panel">
        <ul className="inbox-work">
          {othersTurn.map((item) => (
            <WorkRow
              key={item.id}
              item={item}
              project={projectOf(item)}
              detail={
                item.pullRequest
                  ? pullRequestPhaseView(item.pullRequest.phase).label
                  : item.statusLabel || 'In review'
              }
            />
          ))}
        </ul>
      </div>
    </section>
  );

  const main = [needsSection, resultsSection].filter(Boolean);
  const aside = [alertsSection, runningSection, othersSection].filter(Boolean);
  // An empty Running now card only keeps its place beside other sections.
  const nothingShown =
    main.length === 0 && !alertsSection && !othersSection && running.length === 0;

  return (
    <WorkspacePage className="inbox-page" aria-labelledby="inbox-title">
      <header className="inbox-hero" data-caught-up={caughtUp || undefined}>
        <div className="inbox-hero-text">
          <p className="inbox-date">
            {today.toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          <h1 id="inbox-title">{greeting(today)}</h1>
          <p className="inbox-headline">{headline}</p>
        </div>
        <div className="inbox-hero-actions">
          <Button variant="outline" onClick={() => useWorkViewStore.getState().setScope('all')}>
            All work
          </Button>
          <Button onClick={onNewWork}>
            <Plus size={16} aria-hidden="true" />
            New work
          </Button>
        </div>
      </header>

      <div className="inbox-filters">
        <SegmentedControl<Kind>
          label="Show"
          value={kind}
          onChange={setKind}
          items={[
            { id: 'all', label: 'Everything' },
            { id: 'needs', label: 'Needs you', count: decisions.length },
            { id: 'alerts', label: 'Alerts', count: alerts.length },
            { id: 'activity', label: 'Activity', count: activityCount },
          ]}
        />
        {projects.length > 1 && (
          <Select
            value={projectFilter}
            onValueChange={setProjectFilter}
            aria-label="Project"
            className="inbox-project-filter"
          >
            <SelectItem value="all">All projects</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </Select>
        )}
      </div>

      {nothingShown ? (
        <div className="inbox-calm" role="status">
          <span className="inbox-calm-mark" aria-hidden="true">
            <CheckCircle2 size={28} />
          </span>
          <div>
            <h2>
              {kind === 'all'
                ? 'Nothing waiting on you'
                : kind === 'needs'
                  ? 'Nothing needs you'
                  : kind === 'alerts'
                    ? 'No alerts'
                    : 'No recent activity'}
              {scopeName ? ` in ${scopeName}` : ''}
            </h2>
            <p>New questions, results to review and app alerts collect here as they happen.</p>
            <LinkButton onClick={() => navigateWorkspace('overview')}>See overview</LinkButton>
          </div>
        </div>
      ) : (
        <div
          className="inbox-grid"
          data-single={aside.length === 0 || main.length === 0 || undefined}
        >
          {main.length > 0 && <div className="inbox-main">{main}</div>}
          {aside.length > 0 && <div className="inbox-aside">{aside}</div>}
        </div>
      )}
    </WorkspacePage>
  );
}
