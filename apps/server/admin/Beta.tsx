import { Badge, Button, CopyButton, EmptyState, Panel } from '@jackalope/ui';
import { useRef, useState } from 'react';
import { displayName, message, post, useResource } from './api';
import { ErrorNotice, Heading, Refresh, SelectField } from './components';

interface BetaRequest {
  id: string;
  kind: 'join' | 'leave';
  storeEmail: string;
  email: string;
  status: 'pending' | 'done' | 'declined' | 'withdrawn';
  appVersion: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export function BetaRequests() {
  const [status, setStatus] = useState('pending');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useResource<{ requests: BetaRequest[] }>(
    `/admin/api/beta?${new URLSearchParams({ status })}`,
  );
  const rows = request.data?.requests ?? [];
  const pendingEmails = (kind: BetaRequest['kind']) =>
    [
      ...new Set(
        rows
          .filter((row) => row.status === 'pending' && row.kind === kind)
          .map((row) => row.storeEmail),
      ),
    ].join('\n');
  const joins = pendingEmails('join');
  const leaves = pendingEmails('leave');
  async function resolve(row: BetaRequest, next: 'done' | 'declined') {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await post<{ updated: boolean }>('/admin/api/beta', {
        id: row.id,
        status: next,
      });
      if (!result.updated) throw new Error('This request changed. Refresh the list.');
      setNotice(next === 'done' ? 'Request marked done.' : 'Request declined.');
      request.reload();
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
        title="Beta requests"
        eyebrow="Microsoft Store flight"
        action={
          <Refresh loading={request.loading || busy} onClick={request.reload}>
            Refresh requests
          </Refresh>
        }
      >
        Add or remove these Microsoft accounts in the Partner Center beta flight group, then mark
        each request done.
      </Heading>
      <Panel className="panel">
        <div className="section-heading">
          <SelectField
            label="Status"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setNotice('');
              setError('');
            }}
            disabled={busy}
            options={['pending', 'done', 'declined', 'withdrawn', 'all'].map((value) => [
              value,
              value === 'all' ? 'All requests' : displayName(value),
            ])}
          />
          <span className="notice" role="status">
            {request.loading ? 'Loading requests…' : notice || `${rows.length} requests shown`}
          </span>
        </div>
        {(joins || leaves) && (
          <div className="beta-copy">
            {joins && <CopyButton variant="outline" text={joins} label="Copy emails to add" />}
            {leaves && <CopyButton variant="outline" text={leaves} label="Copy emails to remove" />}
          </div>
        )}
        <ErrorNotice>{error || request.error}</ErrorNotice>
        {rows.map((row) => (
          <article className="feedback-report" key={row.id}>
            <h3>
              <Badge variant={row.kind === 'join' ? 'accent' : 'outline'}>
                {row.kind === 'join' ? 'Join beta' : 'Leave beta'}
              </Badge>{' '}
              {row.storeEmail}
            </h3>
            <small>
              Jackalope account {row.email} · {row.appVersion ?? 'unknown version'} · requested{' '}
              {new Date(row.createdAt).toLocaleDateString()}
              {row.status !== 'pending' &&
                ` · ${displayName(row.status)}${row.resolvedAt ? ` ${new Date(row.resolvedAt).toLocaleDateString()}` : ''}`}
            </small>
            {row.status === 'pending' && (
              <div className="beta-actions">
                <Button
                  disabled={busy || request.loading}
                  onClick={() => void resolve(row, 'done')}
                >
                  {row.kind === 'join' ? 'Mark added' : 'Mark removed'}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || request.loading}
                  onClick={() => void resolve(row, 'declined')}
                >
                  Decline
                </Button>
              </div>
            )}
          </article>
        ))}
        {!rows.length && !request.loading && !request.error && (
          <EmptyState title="You’re all caught up" description="No requests in this view." />
        )}
      </Panel>
      <p className="privacy">
        Microsoft Store accounts can differ from Jackalope sign-in emails. Use the Store account
        shown in each request.
      </p>
    </>
  );
}
