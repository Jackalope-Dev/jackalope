import { Button } from '@jackalope/ui';
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
import { ErrorNotice, Heading, QuickLink, Refresh, SelectField, Table } from './components';

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
            <div className="metric" key={label}>
              <span>{label}</span>
              <strong>{count.toLocaleString()}</strong>
              <a href={href}>{action} →</a>
            </div>
          ))}
        </div>
      )}
      <div className="two-col">
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Next steps</h2>
              <p>Keep invitations and onboarding moving.</p>
            </div>
            <a href="/admin/access#people">View people</a>
          </div>
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
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>Service snapshot</h2>
            <a href="/admin/access#setup">Setup</a>
          </div>
          <ErrorNotice>{setup.error}</ErrorNotice>
          {setup.loading && <p>Checking configuration…</p>}
          {setup.data && (
            <dl className="service-list">
              {[
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
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="privacy">
            Configuration checks do not confirm delivery or a successful installation.
          </p>
        </section>
      </div>
      <section className="panel">
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
      </section>
    </>
  );
}

export function Usage() {
  const [days, setDays] = useState('7');
  const [channel, setChannel] = useState('all');
  const [version, setVersion] = useState('');
  const request = useResource<Overview>(
    `/admin/api/overview?${new URLSearchParams({ days, channel, version })}`,
  );
  const data = request.data;
  const metrics = data?.metrics || [];
  const releases = new Map<string, (string | number)[]>();
  const events = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const metric of metrics) {
    const key = `${metric.version}/${metric.channel}/${metric.os}`;
    const row = releases.get(key) || [
      metric.version,
      displayName(metric.channel),
      audienceLabel(metric.os),
      0,
      0,
      0,
    ];
    if (metric.name === 'app_opened') {
      row[3] = Number(row[3]) + metric.count;
      totals.set(metric.day, (totals.get(metric.day) || 0) + metric.count);
    }
    if (metric.name === 'task_state' && metric.dimension === 'starting')
      row[4] = Number(row[4]) + metric.count;
    if (metric.name === 'app_error') row[5] = Number(row[5]) + metric.count;
    releases.set(key, row);
    if (metric.name === 'feature_used' || metric.name === 'app_error') {
      const key = `${metric.name === 'app_error' ? 'Error' : 'Feature use'} / ${displayName(metric.dimension)}`;
      events.set(key, (events.get(key) || 0) + metric.count);
    }
  }
  const dates = Array.from({ length: Number(days) }, (_, index) =>
    new Date((request.updated || Date.now()) - (Number(days) - index - 1) * 86400000)
      .toISOString()
      .slice(0, 10),
  );
  const peak = Math.max(0, ...totals.values());
  const versions = [
    ...new Set([version, ...(data?.versions.map((row) => row.version) || [])]),
  ].filter(Boolean);
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
        See reported activity and errors across releases.
      </Heading>
      <section className="panel">
        <div className="filters">
          <SelectField
            label="Window"
            value={days}
            onChange={setDays}
            options={[
              ['7', 'Last 7 days'],
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
        </div>
        <ErrorNotice>{request.error}</ErrorNotice>
        <p role="status" className="notice">
          {request.loading
            ? 'Loading aggregate counts…'
            : data
              ? `Updated ${new Date(request.updated).toLocaleTimeString()}${data.truncated ? ' · Partial results — narrow the filters.' : ''}`
              : 'Activity unavailable for this selection. Refresh to try again.'}
        </p>
        {data && (
          <details>
            <summary>About these numbers</summary>
            <p>
              {data.coverage} Retention: {data.retentionDays} days. Ingestion{' '}
              {data.ingestionEnabled ? 'on' : 'off'} · Feedback email{' '}
              {data.emailEnabled ? 'on' : 'off'}.
            </p>
          </details>
        )}
      </section>
      {data && (
        <>
          <div className="metric-grid">
            {[
              ['App opens', 'app_opened'],
              ['Task transitions', 'task_state'],
              ['Feature uses', 'feature_used'],
              ['Reported errors', 'app_error'],
            ].map(([label, name]) => (
              <div className="metric" key={name}>
                <strong>
                  {metrics
                    .filter((row) => row.name === name)
                    .reduce((total, row) => total + row.count, 0)
                    .toLocaleString()}
                </strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <section className="panel">
            <h2>Daily app opens</h2>
            <p>Reported events by UTC receipt date. Includes today’s partial total.</p>
            {!peak && <p className="notice">No app-open events reported in this selection.</p>}
            <svg
              className="admin-chart"
              viewBox={`0 0 ${dates.length * 30} 100`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`Daily app opens, ${dates[0]} to ${dates.at(-1)}. Peak ${peak} per day.`}
            >
              {dates.map((day, index) => {
                const count = totals.get(day) || 0;
                const height = (count / Math.max(1, peak)) * 96;
                return (
                  <rect
                    key={day}
                    x={index * 30 + 2}
                    y={100 - height}
                    width={26}
                    height={height}
                    rx={2}
                  >
                    <title>
                      {day}: {count} opens
                    </title>
                  </rect>
                );
              })}
            </svg>
            <div className="spark-labels">
              <span>{dates[0]}</span>
              <span>Peak {peak} opens / day</span>
              <span>{dates.at(-1)}</span>
            </div>
            <details>
              <summary>Daily counts</summary>
              <Table
                label="Daily app opens"
                headers={['UTC date', 'Opens']}
                rows={dates.map((day) => [day, totals.get(day) || 0])}
              />
            </details>
          </section>
          <section className="panel">
            <h2>Release activity</h2>
            <p>App opens are events, not unique people.</p>
            <Table
              label="Release activity"
              headers={['Version', 'Channel', 'OS', 'Opens', 'Tasks started', 'Errors']}
              rows={[...releases.values()].sort((a, b) => Number(b[3]) - Number(a[3]))}
            />
          </section>
          <section className="panel">
            <h2>Feature use and errors</h2>
            <Table
              label="Feature use and errors"
              headers={['Event / category', 'Count']}
              rows={[...events.entries()].sort((a, b) => b[1] - a[1])}
            />
          </section>
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
      <section className="panel">
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
          <p className="empty">You’re all caught up. No reports in this view.</p>
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
      </section>
      <p className="privacy">
        Written feedback is voluntarily shared content and may contain personal information. Reports
        are retained for a limited time.
      </p>
    </>
  );
}
