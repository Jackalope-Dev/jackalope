import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import { CloudUpload, Rocket } from 'lucide-react';
import { useState } from 'react';
import { DEPLOY_OUTCOME, type DeployStatus, deployAgain } from '../../lib/deploy';
import { ago } from '../../lib/swarm';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

const short = (head?: string | null) => head?.slice(0, 7) ?? '';

/** Where merged work goes next: the Artifacts copy of the branch and its deploys. */
export function SwarmDelivery({
  status,
  onChange,
}: {
  status: DeployStatus;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const last = status.history?.[0];
  const path = status.projectPath;
  if (!status.configured && !status.pushedHead && !status.pushError && !last) return null;
  const retry = async () => {
    if (!path) return;
    setBusy(true);
    setError('');
    try {
      await deployAgain(path);
      onChange();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="swarm-delivery" aria-label="Delivery">
      <div className="swarm-delivery-row">
        {(status.pushedHead || status.pushError) && (
          <p data-tone={status.pushError ? 'danger' : undefined}>
            <CloudUpload size={14} aria-hidden="true" />
            <span>
              {status.pushError
                ? 'Artifacts did not accept the latest merge'
                : `Artifacts has ${status.branch} at `}
              {!status.pushError && <code>{short(status.pushedHead)}</code>}
            </span>
          </p>
        )}
        {status.deploying ? (
          <p data-tone="active">
            <Rocket size={14} aria-hidden="true" />
            <span>
              Deploying <code>{short(status.deploying)}</code>…
            </span>
          </p>
        ) : last ? (
          <p data-tone={last.outcome === 'deployed' ? 'success' : 'danger'}>
            <Rocket size={14} aria-hidden="true" />
            <span>
              {DEPLOY_OUTCOME[last.outcome]} <code>{short(last.head)}</code> ·{' '}
              {ago(last.finishedAt)}
            </span>
          </p>
        ) : (
          status.configured && (
            <p>
              <Rocket size={14} aria-hidden="true" />
              <span>Deploys {status.branch} after each merge</span>
            </p>
          )
        )}
      </div>
      {status.pushError && <InlineNotice tone="warning">{status.pushError}</InlineNotice>}
      {status.halted && !status.deploying && (
        <InlineNotice
          tone="error"
          action={
            <Button variant="outline" disabled={busy} onClick={() => void retry()}>
              Deploy again
            </Button>
          }
        >
          {status.halted} Merges you make still deploy; a successful deploy resumes automatic
          merging.
        </InlineNotice>
      )}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {last && last.outcome !== 'deployed' && last.output && (
        <Disclosure>
          <DisclosureSummary>Deploy output</DisclosureSummary>
          <pre className="swarm-delivery-output">{last.output}</pre>
        </Disclosure>
      )}
    </section>
  );
}
