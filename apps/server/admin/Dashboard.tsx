import { operationCounts } from '@jackalope/contracts/telemetry';
import {
  Button,
  DefinitionList,
  Disclosure,
  DisclosureSummary,
  EmptyState,
  Panel,
  SectionHeader,
  Stat,
} from '@jackalope/ui';
import { useEffect, useRef, useState } from 'react';
import {
  audienceLabel,
  displayName,
  message,
  type Overview,
  post,
  type Readiness,
  type Report,
  type Summary,
  useResource,
} from './api';
import { BarList, Delta, LineChart, SERIES, Sparkline, StackedBars, StepBars } from './charts';
import { ErrorNotice, Heading, QuickLink, Refresh, SelectField, Table } from './components';
import {
  activityPath,
  type Breakdown,
  breakdown,
  dayRange,
  errorGroups,
  improvements,
  label,
  type MetricRow,
  outcomesByAgent,
  series,
  total,
  trend,
  versionAdoption,
} from './insights';

export function Dashboard() {
  const summary = useResource<Summary>('/admin/api/summary');
  const setup = useResource<Readiness>('/admin/api/access/readiness');
  const data = summary.data;
  return (
    <>
      <Heading
        title="Overview"
        eyebrow="Your workspace at a glance"
        action={
          <Refresh
            loading={summary.loading || setup.loading}
            onClick={() => {
              summary.reload();
              setup.reload();
            }}
          >
            Refresh overview
          </Refresh>
        }
      >
        Welcome back. Here’s what’s happening with Jackalope.
      </Heading>
      <ErrorNotice>{summary.error}</ErrorNotice>
      <p role="status" className="notice">
        {summary.loading
          ? 'Loading your dashboard…'
          : data
            ? `Updated ${new Date(summary.updated).toLocaleTimeString()} · Account totals exclude revoked access. Connections reflect first desktop sign-in.`
            : 'Dashboard unavailable. Refresh to try again.'}
      </p>
      {data && (
        <div className="metric-grid">
          {(
            [
              [
                'Waiting for access',
                data.people.waiting,
                'Review waitlist',
                '/admin/access#people',
              ],
              [
                'Approved accounts',
                data.people.approved,
                'Manage people',
                '/admin/access?status=approved#people',
              ],
              [
                'Desktop connected',
                data.people.connected,
                'View connections',
                '/admin/access?status=approved&stage=connected#people',
              ],
              [
                'New feedback',
                data.feedback.find((row) => row.status === 'new')?.count || 0,
                'Open inbox',
                '/admin#feedback',
              ],
            ] as const
          ).map(([label, count, action, href]) => (
            <Stat
              className="metric"
              key={label}
              label={label}
              value={count.toLocaleString()}
              action={<a href={href}>{action} →</a>}
            />
          ))}
        </div>
      )}
      <div className="two-col">
        <Panel className="panel">
          <SectionHeader
            className="section-heading"
            title="Next steps"
            description="Keep invitations and onboarding moving."
            action={<a href="/admin/access#people">View people</a>}
          />
          {data ? (
            <>
              <QuickLink
                title={`${data.people.waiting} waiting for approval`}
                description="Review requests in waitlist priority order."
                href="/admin/access#people"
              />
              <QuickLink
                title={`${data.people.notSignedIn} approved, awaiting sign-in`}
                description="Check their invitation and delivery history."
                href="/admin/access?stage=not-signed-in#people"
              />
              <QuickLink
                title={`${data.people.notConnected} signed in, no desktop yet`}
                description="Follow up on the next onboarding step."
                href="/admin/access?stage=not-connected#people"
              />
              <QuickLink
                title={`${data.mail.needsAttention} emails need attention`}
                description="Latest account email failed or received a delivery warning."
                href="/admin/access?stage=email-failed#people"
              />
            </>
          ) : (
            <p>{summary.loading ? 'Loading follow-ups…' : 'Follow-ups could not be loaded.'}</p>
          )}
        </Panel>
        <Panel className="panel">
          <SectionHeader
            className="section-heading"
            title="Service snapshot"
            action={<a href="/admin/access#setup">Setup</a>}
          />
          <ErrorNotice>{setup.error}</ErrorNotice>
          {setup.loading && <p>Checking configuration…</p>}
          {setup.data && (
            <DefinitionList
              items={[
                ['Early access', setup.data.enabled ? 'Enabled' : 'Disabled'],
                ['Account email', setup.data.mailConfigured ? 'Configured' : 'Needs setup'],
                [
                  setup.data.distribution === 'store' ? 'Microsoft Store' : 'Private installer',
                  setup.data.distribution === 'store'
                    ? 'Link configured'
                    : setup.data.download === 'available'
                      ? setup.data.version || 'Available'
                      : setup.data.download === 'missing'
                        ? 'File missing'
                        : setup.data.download === 'unknown'
                          ? 'Could not check'
                          : 'Not configured',
                ],
              ].map(([label, value]) => ({ label, value }))}
            />
          )}
          <p className="privacy">
            Configuration checks do not confirm delivery or a successful installation.
          </p>
        </Panel>
      </div>
      <Panel className="panel">
        <h2>Stay close to your users</h2>
        <p>Turn requests and feedback into the next useful improvement.</p>
        <div className="two-col">
          <QuickLink
            title="Explore audience insights"
            description="Platforms, preferred agents and workflow priorities"
            href="/admin/access#insights"
          />
          <QuickLink
            title="Write a product update"
            description="Choose changes, preview the email and create a draft"
            href="/admin/access#notes"
          />
        </div>
      </Panel>
    </>
  );
}

export function Usage() {
  const [days, setDays] = useState('14');
  const [channel, setChannel] = useState('all');
  const [version, setVersion] = useState('');
  const [os, setOs] = useState('all');
  const request = useResource<Overview>(
    `/admin/api/overview?${new URLSearchParams({ days, channel, version, os })}`,
  );
  const data = request.data;
  const rows = data?.metrics || [];
  const dates = dayRange(Number(days), request.updated || Date.now());
  const state = (row: MetricRow) => row.dimension.split('|')[0];
  const daily = {
    opens: series(rows, dates, (row) => row.name === 'app_opened'),
    work: series(rows, dates, (row) => row.name === 'work_sent'),
    finished: series(
      rows,
      dates,
      (row) => row.name === 'task_state' && ['review', 'reviewed'].includes(state(row)),
    ),
    errors: series(rows, dates, (row) => row.name === 'app_error'),
  };
  const versions = [
    ...new Set([version, ...(data?.versions.map((row) => row.version) || [])]),
  ].filter(Boolean);
  const named = (entries: Breakdown[], prefix = '') =>
    entries.map((entry) => ({ ...entry, label: `${prefix}${label(entry.key)}` }));
  const features = [
    ...named(
      breakdown(rows, dates, 'feature_used', ([feature]) => feature),
      'Visited ',
    ),
    ...named(breakdown(rows, dates, 'action_used', ([action]) => action)),
  ].sort((a, b) => b.total - a.total);
  const shapes = named(breakdown(rows, dates, 'work_sent', ([shape]) => shape));
  const agents = named(breakdown(rows, dates, 'work_sent', ([, agent]) => agent));
  const withFiles = breakdown(rows, dates, 'work_sent', ([, , files]) =>
    files && files !== '0' ? 'With attached files' : 'Without files',
  );
  const withWindow = breakdown(rows, dates, 'work_sent', ([, , , window]) =>
    window === 'window' ? 'With an attached window' : 'Without a window',
  );
  const platforms = named(
    breakdown(rows, dates, 'app_opened', (_, row) => `${row.os} · ${row.channel}`),
  ).map((entry) => ({
    ...entry,
    label: entry.key
      .split(' · ')
      .map((part, index) => (index ? displayName(part) : audienceLabel(part)))
      .join(' · '),
  }));
  const settings = named(breakdown(rows, dates, 'setting_changed', ([setting]) => setting));
  const adoption = versionAdoption(rows, dates);
  const errors = errorGroups(rows, dates);
  const fixes = improvements(rows, dates);
  const outcomes = outcomesByAgent(rows);
  const tiles = [
    ['App opens', daily.opens, false, 'Times Jackalope was opened'],
    ['Work sent', daily.work, false, 'Conversations, plans and comparisons started'],
    ['Runs finished', daily.finished, false, 'Agent runs that reached review'],
    ['Errors reported', daily.errors, true, 'Known categories, with consent'],
  ] as const;
  return (
    <>
      <Heading
        title="Usage & releases"
        eyebrow="Product health"
        action={
          <Refresh loading={request.loading} onClick={request.reload}>
            Refresh activity
          </Refresh>
        }
      >
        How Jackalope is used and where it struggles, from anonymous daily counts.
      </Heading>
      <Panel className="panel">
        <div className="filters">
          <SelectField
            label="Window"
            value={days}
            onChange={setDays}
            options={[
              ['7', 'Last 7 days'],
              ['14', 'Last 14 days'],
              ['30', 'Last 30 days'],
            ]}
          />
          <SelectField
            label="Channel"
            value={channel}
            onChange={setChannel}
            options={[
              ['all', 'All channels'],
              ['stable', 'Stable'],
              ['beta', 'Beta'],
            ]}
          />
          <SelectField
            label="Version"
            value={version}
            onChange={setVersion}
            options={[['', 'All versions'], ...versions.map((value) => [value, value] as const)]}
          />
          <SelectField
            label="Operating system"
            value={os}
            onChange={setOs}
            options={['all', 'windows', 'macos', 'linux'].map((value) => [
              value,
              value === 'all' ? 'All operating systems' : audienceLabel(value),
            ])}
          />
        </div>
        <ErrorNotice>{request.error}</ErrorNotice>
        <p role="status" className="notice">
          {request.loading
            ? 'Loading usage…'
            : data
              ? `Updated ${new Date(request.updated).toLocaleTimeString()} · Counts are events, not people. Changes compare the later half of the window with the earlier half.${data.truncated ? ' Partial results — narrow the filters.' : ''}`
              : 'Usage unavailable for this selection. Refresh to try again.'}
        </p>
        {data && (
          <Disclosure>
            <DisclosureSummary>About these numbers</DisclosureSummary>
            <p>
              {data.coverage} Retention: {data.retentionDays} days. Ingestion{' '}
              {data.ingestionEnabled ? 'on' : 'off'} · Feedback email{' '}
              {data.emailEnabled ? 'on' : 'off'}.
            </p>
          </Disclosure>
        )}
      </Panel>
      {data && !rows.length && (
        <Panel className="panel">
          <EmptyState
            title="No usage reported in this selection"
            description="Widen the window or clear a filter. Only installs that share usage counts report here."
          />
        </Panel>
      )}
      {data && rows.length > 0 && (
        <>
          <div className="usage-hero">
            {tiles.map(([title, values, invert, hint]) => (
              <div className="usage-tile" key={title} title={hint}>
                <span>{title}</span>
                <strong>{total(values).toLocaleString()}</strong>
                <span className="usage-tile-foot">
                  <Delta trend={trend(values)} invert={invert} />
                  <Sparkline values={values} color={invert ? 'var(--color-danger)' : undefined} />
                </span>
              </div>
            ))}
          </div>
          <Panel className="panel">
            <h2>Activity over time</h2>
            <p>Daily events by UTC date. Today is partial.</p>
            <LineChart
              dates={dates}
              label={`Daily app opens, work sent and runs finished from ${dates[0]} to ${dates.at(-1)}`}
              lines={[
                { key: 'App opens', values: daily.opens, color: SERIES[0] },
                { key: 'Work sent', values: daily.work, color: SERIES[1] },
                { key: 'Runs finished', values: daily.finished, color: SERIES[2] },
              ]}
            />
            <Disclosure>
              <DisclosureSummary>Show as a table</DisclosureSummary>
              <Table
                label="Daily activity"
                headers={['UTC date', 'App opens', 'Work sent', 'Runs finished', 'Errors']}
                rows={dates.map((day, index) => [
                  day,
                  daily.opens[index],
                  daily.work[index],
                  daily.finished[index],
                  daily.errors[index],
                ])}
              />
            </Disclosure>
          </Panel>
          <div className="usage-grid">
            <Panel className="panel">
              <h2>What to improve</h2>
              <p>Operations, agents and pages whose failures stand out in this window.</p>
              {fixes.length ? (
                <ul className="improve-list">
                  {fixes.slice(0, 6).map((fix) => (
                    <li key={fix.title}>
                      <span className="improve-tone" data-tone={fix.tone}>
                        {fix.tone === 'danger' ? 'High' : 'Watch'}
                      </span>
                      <strong>{fix.title}</strong>
                      <span>{fix.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="notice">Nothing stands out. Failure rates are low in this window.</p>
              )}
            </Panel>
            <Panel className="panel">
              <h2>From opening to finished work</h2>
              <p>Event counts at each step, not people moving through them.</p>
              <StepBars steps={activityPath(rows)} />
            </Panel>
          </div>
          <Panel className="panel">
            <h2>Version adoption</h2>
            <p>App opens per day by version; smaller versions are grouped as Other.</p>
            {adoption.length ? (
              <>
                <StackedBars
                  dates={dates}
                  layers={adoption}
                  label={`Daily app opens by version from ${dates[0]} to ${dates.at(-1)}`}
                  order={data.versions.map((row) => row.version)}
                />
                <Disclosure>
                  <DisclosureSummary>Show as a table</DisclosureSummary>
                  <Table
                    label="App opens by version"
                    headers={['Version', 'Opens', 'Share']}
                    rows={adoption.map((layer) => [
                      layer.key,
                      total(layer.daily),
                      `${Math.round((total(layer.daily) / Math.max(1, total(daily.opens))) * 100)}%`,
                    ])}
                  />
                </Disclosure>
              </>
            ) : (
              <p className="notice">No app opens in this selection.</p>
            )}
          </Panel>
          <div className="usage-grid">
            <Panel className="panel usage-span">
              <h2>Features used</h2>
              <p>Page visits and feature moments, most used first.</p>
              <BarList items={features.slice(0, 16)} empty="No feature use reported." />
            </Panel>
            <Panel className="panel">
              <h2>Work started</h2>
              <p>What people start from the composer.</p>
              <BarList items={shapes} empty="No work sent in this selection." />
              <h3>By agent</h3>
              <BarList items={agents} empty="No work sent in this selection." />
              <h3>Context</h3>
              <BarList
                items={named([...withFiles, ...withWindow]).map((entry) => ({
                  ...entry,
                  label: entry.key,
                }))}
                empty="No work sent in this selection."
              />
            </Panel>
            <Panel className="panel">
              <h2>Platforms and channels</h2>
              <p>App opens by operating system and release channel.</p>
              <BarList items={platforms} empty="No app opens in this selection." />
              <h3>Settings changed</h3>
              <BarList items={settings} empty="No preference changes reported." />
            </Panel>
          </div>
          <Panel className="panel">
            <h2>Run outcomes by agent</h2>
            <p>
              Runs that ended in this window. Ready to review is an agent finishing, not an accepted
              outcome or a merge.
            </p>
            <Table
              label="Run outcomes by agent"
              headers={['Agent', 'Finished', 'Failed', 'Stopped', 'Failure rate']}
              rows={outcomes.map((row) => [
                displayName(row.agent),
                row.finished,
                row.failed,
                row.stopped,
                `${Math.round(row.failureRate * 100)}%`,
              ])}
            />
          </Panel>
          <Panel className="panel error-table">
            <h2>Errors</h2>
            <p>
              Grouped by category, kind and where they happened. Messages and stack traces are never
              collected, so a group points at an area to investigate.
            </p>
            {errors.length ? (
              <Table
                label="Errors by category"
                headers={[
                  'Category',
                  'Kind',
                  'Where',
                  'Count',
                  'Change',
                  'Versions',
                  'First seen',
                  'Last seen',
                ]}
                rows={errors.map((group) => [
                  label(group.code),
                  group.kind ? label(group.kind) : '—',
                  [group.operation, group.feature].filter(Boolean).map(label).join(' · ') || '—',
                  group.total,
                  group.trend.change === null
                    ? group.trend.current
                      ? 'New'
                      : '—'
                    : `${group.trend.change > 0 ? '+' : ''}${Math.round(group.trend.change * 100)}%`,
                  group.versions.slice(0, 3).join(', ') +
                    (group.versions.length > 3 ? ` +${group.versions.length - 3}` : ''),
                  group.first,
                  group.last,
                ])}
              />
            ) : (
              <p className="notice">No errors reported in this selection.</p>
            )}
          </Panel>
          <Panel className="panel">
            <h2>Operation results</h2>
            <p>
              One result per reported operation. Accepted means the native command acknowledged the
              request; task starts and queued Chat messages can still fail later. Failed results
              include rejected requests and failed checks. Partial means a merge applied but cleanup
              did not finish.
            </p>
            <Table
              label="Operation results"
              headers={['Operation', 'Accepted', 'Failed', 'Blocked', 'Partial', 'Canceled']}
              rows={operationCounts(rows).map((row) => [
                displayName(row.operation),
                row.accepted,
                row.failed,
                row.blocked,
                row.partial,
                row.canceled,
              ])}
            />
          </Panel>
        </>
      )}
    </>
  );
}

export function Feedback() {
  const [status, setStatus] = useState('new');
  const [cursor, setCursor] = useState<number | null>(null);
  const [rows, setRows] = useState<Report[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useResource<{ reports: Report[] }>(
    `/admin/api/feedback?${new URLSearchParams({ status, ...(cursor !== null ? { before: String(cursor) } : {}) })}`,
  );
  useEffect(() => {
    if (request.data)
      setRows((previous) =>
        cursor === null
          ? request.data?.reports || []
          : [...previous, ...(request.data?.reports || [])],
      );
  }, [request.data, cursor]);
  function refresh() {
    setCursor(null);
    setRows([]);
    setError('');
    setNotice('');
    request.reload();
  }
  async function update(row: Report, status: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await post<{ updated: boolean }>('/admin/api/feedback', {
        id: row.id,
        status,
      });
      if (!result.updated)
        throw new Error('This report is no longer available. Refresh the inbox.');
      refresh();
      setNotice('Report status updated.');
    } catch (error) {
      setError(message(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="Feedback"
        eyebrow="Listen & improve"
        action={
          <Refresh loading={request.loading || busy} onClick={refresh}>
            Refresh inbox
          </Refresh>
        }
      >
        A shared inbox for reports, ideas and replies from your users.
      </Heading>
      <Panel className="panel">
        <div className="section-heading">
          <SelectField
            label="Status"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setCursor(null);
              setRows([]);
              setNotice('');
              setError('');
            }}
            disabled={busy}
            options={['new', 'reviewing', 'planned', 'closed', 'all'].map((value) => [
              value,
              value === 'all' ? 'All reports' : displayName(value),
            ])}
          />
          <span className="notice" role="status">
            {request.loading ? 'Loading reports…' : notice || `${rows.length} reports shown`}
          </span>
        </div>
        <ErrorNotice>{error || request.error}</ErrorNotice>
        {rows.map((row) => {
          const report = JSON.parse(row.payload) as {
            kind?: string;
            appVersion?: string;
            channel?: string;
            source?: string;
            message: string;
          };
          return (
            <article className="feedback-report" key={row.id}>
              <h3>
                {displayName(report.kind || 'feedback')} · {report.appVersion || 'Email response'} /{' '}
                {report.channel || (report.source === 'email' ? 'private invitation' : 'legacy')}
              </h3>
              <small>
                {row.id} · {new Date(row.received_at).toLocaleDateString()} · email{' '}
                {row.email_state}
              </small>
              <pre>{report.message}</pre>
              <SelectField
                label="Report status"
                value={row.status}
                onChange={(status) => void update(row, status)}
                disabled={busy || request.loading}
                options={['new', 'reviewing', 'planned', 'closed'].map((value) => [
                  value,
                  displayName(value),
                ])}
              />
            </article>
          );
        })}
        {!rows.length && !request.loading && !request.error && (
          <EmptyState title="You’re all caught up" description="No reports in this view." />
        )}
        {request.data?.reports.length === 50 && (
          <Button
            variant="secondary"
            disabled={request.loading || busy}
            onClick={() => setCursor(rows.at(-1)?.cursor ?? null)}
          >
            Load older reports
          </Button>
        )}
      </Panel>
      <p className="privacy">
        Written feedback is voluntarily shared content and may contain personal information. Reports
        are retained for a limited time.
      </p>
    </>
  );
}
