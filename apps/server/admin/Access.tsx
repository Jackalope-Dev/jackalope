import {
  Button,
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
  useDialogFocus,
} from '@jackalope/ui';
import { useEffect, useRef, useState } from 'react';
import {
  audienceLabel,
  date,
  deliveryNames,
  groupNames,
  type Insights,
  type Mail,
  type Member,
  type MemberDetail,
  mailNames,
  mailStatus,
  message,
  type PeopleResponse,
  post,
  type Readiness,
  useResource,
} from './api';
import { ErrorNotice, Heading, Refresh, SelectField } from './components';

const stages = [
  ['all', 'All stages'],
  ['not-signed-in', 'Approved, not signed in'],
  ['not-connected', 'Signed in, no desktop yet'],
  ['connected', 'Connected a desktop'],
  ['email-failed', 'Email needs attention'],
] as const;
type Action = 'approve' | 'resend' | 'revoke' | 'restore';
function filtersFrom(search: string) {
  const params = new URLSearchParams(search);
  const stage = params.get('stage') || 'all';
  const status = params.get('status') || (stage !== 'all' ? 'all' : 'waiting');
  return {
    status: Object.hasOwn(groupNames, status) ? status : 'waiting',
    stage: stages.some(([value]) => value === stage) ? stage : 'all',
    query: '',
    platform: 'all',
    sort: 'priority',
  };
}
export function People({ search }: { search: string }) {
  const [filters, setFilters] = useState(() => filtersFrom(search));
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [members, setMembers] = useState<Member[]>([]);
  const [detail, setDetail] = useState<Member | null>(null);
  const [action, setAction] = useState<{ person: Member; kind: Action; label: string } | null>(
    null,
  );
  const [notice, setNotice] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const request = useResource<PeopleResponse>(
    `/admin/api/access?${new URLSearchParams({ ...filters, offset: String(offset) })}`,
  );
  const readiness = useResource<Readiness>('/admin/api/access/readiness');
  const [counts, setCounts] = useState<PeopleResponse['counts']>([]);
  useEffect(() => {
    setFilters(filtersFrom(search));
    setQuery('');
    setOffset(0);
    setMembers([]);
  }, [search]);
  useEffect(() => {
    if (request.data) {
      const data = request.data;
      setMembers((previous) => (offset ? [...previous, ...data.members] : data.members));
      setCounts(data.counts);
    }
  }, [request.data, offset]);
  function change(next: Partial<typeof filters>) {
    setFilters((value) => ({ ...value, ...next }));
    setOffset(0);
    setMembers([]);
    setNotice('');
  }
  function refresh() {
    setOffset(0);
    setMembers([]);
    request.reload();
  }
  const countMap = Object.fromEntries(counts.map((row) => [row.status, row.count]));
  countMap.all = counts.reduce((sum, row) => sum + row.count, 0);
  return (
    <>
      <Heading
        title="People"
        eyebrow="Early access"
        action={
          <Refresh loading={request.loading} onClick={refresh}>
            Refresh people
          </Refresh>
        }
      >
        Review requests and help people take their next step.
      </Heading>
      <section className="panel">
        <h2>Manage access</h2>
        <p>
          Waitlist referrals are unlimited. Each verified signup earns one day of priority. Instant
          Access Passes are a separate allowance after acceptance.
        </p>
        <div className="tabs" role="group" aria-label="Filter people">
          {Object.entries(groupNames).map(([value, label]) => (
            <Button
              key={value}
              variant="ghost"
              aria-pressed={filters.status === value}
              onClick={() => change({ status: value })}
            >
              {label} ({countMap[value] ?? '…'})
            </Button>
          ))}
        </div>
        <form
          className="filters"
          onSubmit={(event) => {
            event.preventDefault();
            change({ query });
          }}
        >
          <SelectField
            label="Order"
            value={filters.sort}
            onChange={(sort) => change({ sort })}
            options={[
              ['priority', 'Waitlist priority'],
              ['referrals', 'Most referrals'],
              ['newest', 'Newest first'],
            ]}
          />
          <FormField label="Find an email">
            <Input
              ref={searchRef}
              type="search"
              maxLength={254}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search in the selected group"
            />
          </FormField>
          <SelectField
            label="Platform"
            value={filters.platform}
            onChange={(platform) => change({ platform })}
            options={[
              ['all', 'All platforms'],
              ['macos', 'macOS'],
              ['windows', 'Windows'],
              ['linux', 'Linux'],
            ]}
          />
          <SelectField
            label="Onboarding stage"
            value={filters.stage}
            onChange={(stage) => change({ stage, status: 'all' })}
            options={stages}
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setQuery('');
              change(filtersFrom(''));
              history.replaceState(null, '', '/admin/access#people');
            }}
          >
            Clear filters
          </Button>
        </form>
        <ErrorNotice>{request.error}</ErrorNotice>
        <p className="notice" role="status">
          {request.loading
            ? 'Loading people…'
            : notice || `Showing ${members.length} ${members.length === 1 ? 'person' : 'people'}`}
        </p>
        <div aria-busy={request.loading}>
          {members.map((person) => (
            <article className="person" key={person.id}>
              <div>
                <h3>{person.email}</h3>
                <span className="status">
                  {person.status === 'revoked'
                    ? 'Access revoked'
                    : person.status === 'waiting'
                      ? 'Waiting for approval'
                      : person.devices > 0
                        ? 'Desktop connected'
                        : person.verified_at
                          ? 'Signed in to website'
                          : 'Approved · awaiting first sign-in'}
                </span>
                <p>Requested {date(person.created_at)}</p>
                <p>
                  {mailNames[person.mail_kind || ''] || 'Email'}: {mailStatus(person)}
                </p>
                <p>
                  {person.position ? `#${person.position} in line · ` : ''}
                  {person.referral_count} verified referrals · {person.pending_referrals} awaiting
                  verification · {person.accepted || 0} passes claimed
                </p>
                {person.preferences && (
                  <p>
                    {((preferences: { platforms: string[]; agents: string[] }) =>
                      [...preferences.platforms, ...preferences.agents]
                        .map(audienceLabel)
                        .join(' · '))(JSON.parse(person.preferences))}
                  </p>
                )}
              </div>
              <div className="actions">
                <Button
                  variant="secondary"
                  disabled={request.loading}
                  onClick={() => setDetail(person)}
                >
                  Details
                </Button>
                {(person.status === 'waiting'
                  ? [
                      ['approve', 'Approve & email'],
                      ['revoke', 'Remove from waitlist'],
                    ]
                  : person.status === 'approved'
                    ? [
                        ['resend', 'Send access link'],
                        ['revoke', 'Revoke access'],
                      ]
                    : [['restore', 'Return to waitlist']]
                ).map(([kind, label]) => (
                  <Button
                    key={kind}
                    variant={kind === 'approve' ? 'primary' : 'outline'}
                    disabled={request.loading}
                    onClick={() => setAction({ person, kind: kind as Action, label })}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </article>
          ))}
        </div>
        {!request.loading && !request.error && !members.length && (
          <p className="empty">
            No people match this view. Try another group or use Clear filters.
          </p>
        )}
        {request.data?.hasMore && (
          <Button
            variant="secondary"
            disabled={request.loading}
            onClick={() => setOffset(members.length)}
          >
            Load more people
          </Button>
        )}
      </section>
      {detail && <Details person={detail} onClose={() => setDetail(null)} />}
      {action && (
        <ConfirmAction
          {...action}
          ready={readiness.data}
          onClose={() => setAction(null)}
          onDone={(text) => {
            setAction(null);
            refresh();
            setNotice(text);
            requestAnimationFrame(() => searchRef.current?.focus());
          }}
        />
      )}
    </>
  );
}

function ConfirmAction({
  person,
  kind,
  label,
  ready,
  onClose,
  onDone,
}: {
  person: Member;
  kind: Action;
  label: string;
  ready: Readiness | null;
  onClose: () => void;
  onDone: (notice: string) => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [error, setError] = useState('');
  const focus = useDialogFocus();
  const needsDownload = kind === 'approve' && ready?.download !== 'available';
  const configured =
    (kind !== 'approve' && kind !== 'resend') || !!(ready?.enabled && ready.mailConfigured);
  const copy = {
    approve: `This grants early access and queues one approval email with a private link. Their Instant Access Pass allowance is ${person.invite_limit}.`,
    resend:
      'This queues a new sign-in link. It expires in 30 minutes. A one-minute cooldown and daily limit prevent repeated emails.',
    revoke:
      'This ends website sessions and desktop account access, and cancels pending invitations. Local projects and already accepted invitees keep their own access.',
    restore:
      'This returns the person to the waitlist. It sends no email and does not restore old sign-in links or desktop credentials.',
  };
  async function confirm() {
    if (sending.current || !configured || (needsDownload && !acknowledged)) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await post<{ mailQueued?: boolean }>('/admin/api/access', {
        id: person.id,
        action: kind,
        allowWithoutDownload: kind === 'approve' && acknowledged,
      });
      onDone(
        `Access updated for ${person.email}. ${kind === 'approve' || kind === 'resend' ? (result.mailQueued ? 'Email added to the outbox. Delivery is not confirmed yet.' : 'No new email was queued. A recent request or daily limit may apply; check Details before retrying.') : ''}`,
      );
    } catch (error) {
      setError(message(error));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !sending.current) onClose();
      }}
    >
      <DialogContent
        {...focus}
        onEscapeKeyDown={(event) => {
          if (sending.current) event.preventDefault();
        }}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader title={`${label}?`} description={person.email} />
        <p>{copy[kind]}</p>
        {needsDownload && (
          <label className="confirmation">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              disabled={busy}
            />
            <span>
              No download is available or it could not be checked. I understand this person may see
              “No download available yet.”
            </span>
          </label>
        )}
        <ErrorNotice>
          {error ||
            (!configured
              ? 'Recheck setup and configure early access and email before sending.'
              : '')}
        </ErrorNotice>
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={kind === 'revoke' ? 'danger' : 'primary'}
            disabled={busy || !configured || (needsDownload && !acknowledged)}
            onClick={() => void confirm()}
          >
            {busy ? 'Updating…' : label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Details({ person, onClose }: { person: Member; onClose: () => void }) {
  const request = useResource<MemberDetail>(
    `/admin/api/access/member?id=${encodeURIComponent(person.id)}`,
  );
  const focus = useDialogFocus();
  const data = request.data;
  const member = data?.member;
  const preferences = member?.preferences
    ? (JSON.parse(member.preferences) as Record<string, string[]>)
    : null;
  const facts =
    member && data
      ? [
          ['Access', groupNames[member.status]],
          ...(preferences
            ? [
                [
                  'Operating systems',
                  preferences.platforms.map(audienceLabel).join(', ') || 'Not answered',
                ],
                [
                  'Preferred agents',
                  preferences.agents.map(audienceLabel).join(', ') || 'Not answered',
                ],
                [
                  'Priorities',
                  preferences.priorities.map(audienceLabel).join(', ') || 'Not answered',
                ],
              ]
            : []),
          [
            'Waitlist referrals',
            `${member.referral_count} verified · ${member.pending_referrals} awaiting verification`,
          ],
          ['Waitlist verified', date(member.waitlist_verified_at)],
          ['Campaign', member.campaign || 'Not recorded'],
          ['Requested', date(member.created_at)],
          ['Approved', date(member.approved_at)],
          ['First website sign-in', date(member.verified_at)],
          ['Connected desktops', String(data.devices.length)],
          [
            'Instant Access Passes',
            `${data.invites.filter((row) => row.status === 'accepted').reduce((sum, row) => sum + row.count, 0)} accepted · ${data.invites.filter((row) => row.status === 'pending').reduce((sum, row) => sum + row.count, 0)} pending · ${member.invite_limit} allowance`,
          ],
          [
            'Product notes',
            member.newsletter_confirmed_at
              ? member.newsletter_synced_at
                ? 'Opted in · synced'
                : (member.newsletter_attempts || 0) >= 5
                  ? 'Opted in · sync needs attention'
                  : 'Opted in · sync pending'
              : member.newsletter
                ? 'Awaiting email confirmation'
                : 'Not opted in',
          ],
        ]
      : [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent {...focus}>
        <DialogHeader
          title={<span className="admin-dialog-title">{person.email}</span>}
          description="Account details and retained email history"
        />
        <DialogCloseButton label="Close person details" />
        <ErrorNotice>{request.error}</ErrorNotice>
        {request.error && (
          <Refresh loading={request.loading} onClick={request.reload}>
            Retry details
          </Refresh>
        )}
        {request.loading && <p role="status">Loading details…</p>}
        {data && (
          <>
            <dl className="facts">
              {facts.map(([label, value]) => (
                <Fact key={label} label={label} value={value} />
              ))}
            </dl>
            <p>
              Website sign-in and desktop connection do not establish that a task was completed.
            </p>
            {data.feedback && (
              <section>
                <h3>Feedback follow-up</h3>
                <p>
                  {data.feedback.completed_at
                    ? 'Feedback received; this round is complete.'
                    : data.feedback.enabled
                      ? 'Email follow-up enabled by this member.'
                      : 'Feedback emails are off.'}
                </p>
                <p>
                  Shared activity: {data.feedback.active_days} of 2 active days;{' '}
                  {data.feedback.opened_results} of 2 opened results. These milestones do not prove
                  satisfaction.
                </p>
                <p>
                  In-app invitations: {data.feedback.prompt_count} of 2. Email invitation:{' '}
                  {data.feedback.email_requested ? 'requested' : 'not requested'}.
                </p>
                <p>Next eligible request: {date(data.feedback.next_prompt_at)}</p>
              </section>
            )}
            <h3>Recent emails</h3>
            <p>
              Up to 10 retained messages. Mail-server acceptance does not confirm inbox placement.
            </p>
            {data.mail.length ? (
              data.mail.map((mail) => <EmailEntry key={mail.id} mail={mail} />)
            ) : (
              <p>No email history retained.</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
function EmailEntry({ mail }: { mail: Mail }) {
  const [result, setResult] = useState<{ status: string; checkedAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function check() {
    setBusy(true);
    setError('');
    try {
      setResult(await post('/admin/api/access/delivery', { id: mail.id }));
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="email-entry">
      <strong>{mailNames[mail.kind] || 'Account email'}</strong>
      <p>{date(mail.created_at)}</p>
      <p>{result ? deliveryNames[result.status] || deliveryNames.unknown : mailStatus(mail)}</p>
      {(result?.checkedAt || mail.delivery_checked_at) && (
        <small>Last checked {date(result?.checkedAt || mail.delivery_checked_at)}</small>
      )}
      <ErrorNotice>{error}</ErrorNotice>
      {mail.can_check ? (
        <div className="actions">
          <Button variant="secondary" disabled={busy} onClick={() => void check()}>
            {busy ? 'Checking…' : 'Check delivery'}
          </Button>
        </div>
      ) : (
        mail.state === 'queued' && (
          <p>Delivery lookup is unavailable for this older message. Check Sequenzy.</p>
        )
      )}
    </section>
  );
}

export function Audience() {
  const request = useResource<Insights>('/admin/api/access/insights');
  return (
    <>
      <Heading
        title="Audience insights"
        eyebrow="Audience"
        action={
          <Refresh loading={request.loading} onClick={request.reload}>
            Refresh insights
          </Refresh>
        }
      >
        Understand who is waiting and what they want to build.
      </Heading>
      <section className="panel">
        <h2>What future users need</h2>
        <ErrorNotice>{request.error}</ErrorNotice>
        <p role="status">
          {request.data
            ? `${request.data.totals.responded} of ${request.data.totals.requested} people answered · ${request.data.totals.approved || 0} approved · ${request.data.totals.connected || 0} connected a desktop`
            : request.loading
              ? 'Loading preferences…'
              : 'Preferences could not be loaded.'}
        </p>
        {request.data && (
          <div className="insight-grid">
            {(
              [
                ['platforms', 'Operating systems'],
                ['agents', 'Preferred agents'],
                ['priorities', 'Workflow priorities'],
                ['sources', 'Signup sources'],
              ] as const
            ).map(([key, title]) => (
              <section key={key}>
                <h3>{title}</h3>
                <div className="bars">
                  {request.data?.[key].map((row) => (
                    <div key={row.label}>
                      <div className="bar-label">
                        <span>{audienceLabel(row.label)}</span>
                        <span>{row.count}</span>
                      </div>
                      <meter
                        min={0}
                        max={Math.max(1, ...(request.data?.[key].map((row) => row.count) || []))}
                        value={row.count}
                        aria-label={`${audienceLabel(row.label)}: ${row.count}`}
                      />
                    </div>
                  ))}
                </div>
                {!request.data?.[key].length && <p>No responses yet</p>}
              </section>
            ))}
          </div>
        )}
        <p className="privacy">
          Optional answers, multiple choices per person. These describe respondents, not all
          visitors. Missing answers are not zero demand.
        </p>
      </section>
    </>
  );
}

export function Setup() {
  const request = useResource<Readiness>('/admin/api/access/readiness');
  const ready = request.data;
  return (
    <>
      <Heading
        title="Service setup"
        eyebrow="Operations"
        action={
          <Refresh loading={request.loading} onClick={request.reload}>
            Recheck setup
          </Refresh>
        }
      >
        Check access, email and distribution before your next invitation.
      </Heading>
      <section className="panel">
        <h2>Before you invite</h2>
        <ErrorNotice>{request.error}</ErrorNotice>
        <p role="status">
          {ready
            ? ready.enabled && ready.mailConfigured && ready.download === 'available'
              ? 'The service and download are configured. Complete the first-user trial before approving someone.'
              : 'Finish setup before inviting someone to use the app.'
            : request.loading
              ? 'Checking the service and private download…'
              : 'Setup could not be checked.'}
        </p>
        {ready && (
          <ul className="checks">
            {[
              [
                'Early access',
                ready.enabled ? 'Enabled' : 'Disabled',
                ready.enabled
                  ? 'Requests can be approved.'
                  : 'Enable early access in the service configuration.',
              ],
              [
                'Email service',
                ready.mailConfigured ? 'Configured' : 'Needs setup',
                ready.mailConfigured
                  ? 'Confirm real inbox delivery with your own account.'
                  : 'Configure the sender and email service credentials.',
              ],
              [
                ready.distribution === 'store' ? 'Microsoft Store' : 'Private download',
                ready.distribution === 'store'
                  ? 'Link configured'
                  : ready.download === 'available'
                    ? `Available · ${ready.version}`
                    : 'Not ready',
                ready.distribution === 'store'
                  ? 'Verify the listing opens for a tester and complete Store installation before inviting users.'
                  : ready.download === 'available'
                    ? 'File exists. Validate its signature and installation before inviting users.'
                    : ready.download === 'missing'
                      ? 'The configured installer is missing or empty.'
                      : ready.download === 'unknown'
                        ? 'Could not read the installer. Check storage and retry.'
                        : 'Configure the accepted Microsoft Store link, or upload a reviewed private installer.',
              ],
            ].map(([title, status, description]) => (
              <li key={title}>
                <span>{title}</span>
                <strong>{status}</strong>
                <small>{description}</small>
              </li>
            ))}
          </ul>
        )}
        <details>
          <summary>First-user onboarding checklist</summary>
          <ol>
            <li>
              Configure the certified Microsoft Store listing link, or upload a reviewed,
              publisher-signed Windows installer and configure its private download key.
            </li>
            <li>
              Use your own approved account to test the email, sign-in and download. Install in a
              clean Windows profile; create a project, connect an agent, finish a small task and
              review its changes.
            </li>
            <li>
              Check the published privacy notice, terms and monitored support address. Confirm the
              desktop account connection, restart and disconnect flows if this build includes them.
            </li>
            <li>
              Approve the first person when you can help them. Ask them to complete one small task
              and tell you where they get stuck.
            </li>
          </ol>
          <p>
            Setup checks show configuration and file availability. They do not verify the publisher
            signature, installation, inbox placement or a completed user task.
          </p>
        </details>
      </section>
      <section className="panel">
        <h2>Email templates</h2>
        <p>Preview the messages people receive during onboarding.</p>
        <details>
          <summary>Browse email previews</summary>
          <nav aria-label="Email previews">
            {[
              ['waitlist', 'Waitlist verification'],
              ['invite', 'Instant Access Pass'],
              ['referral', 'Referral milestone'],
              ['passes_ready', 'Passes ready'],
              ['pass_claimed', 'Pass claimed'],
              ['pass_expired', 'Pass expired'],
              ['welcome', 'Approval email'],
              ['login', 'Sign-in email'],
            ].map(([kind, label]) => (
              <a
                key={kind}
                href={`/admin/access/email-preview?kind=${kind}`}
                target="_blank"
                rel="noreferrer"
              >
                {label}
              </a>
            ))}
          </nav>
          <p>Previews use sample data and cannot sign anyone in.</p>
        </details>
      </section>
    </>
  );
}
