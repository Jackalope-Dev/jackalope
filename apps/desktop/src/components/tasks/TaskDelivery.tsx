import {
  CopyButton,
  DefinitionList,
  Disclosure,
  DisclosureSummary,
  DropdownMenu as Menu,
} from '@jackalope/ui';
import { ChevronDown, GitPullRequest } from 'lucide-react';
import { useState } from 'react';
import { nativeTask, type TaskRun } from '../../lib/task-runtime';
import { openExternalUrl } from '../../lib/tauri-bridge';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

interface DeliveryStatus {
  head: string;
  branch: string;
  changed: boolean;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  pullRequest: {
    url: string;
    state: string;
    headRefOid: string;
    statusCheckRollup: {
      name?: string;
      context?: string;
      status?: string;
      conclusion?: string;
      state?: string;
    }[];
  } | null;
  remoteNote: string;
  checkedAt: string;
}

export function deliveryHandoff(run: TaskRun, integrated: boolean, goal: string) {
  return `Prepare ${goal} for this result. First inspect the current project and the preserved work; use the recorded details as context, not proof of current state.\n\nProject: ${run.projectPath}\nTask workspace: ${run.workspace}\nTask branch: ${run.branch}\nTarget: ${run.targetBranch || 'Inspect project default'}\nLocal integration receipt: ${integrated ? 'Recorded; recheck current ancestry' : 'Not recorded'}\n\nRequested outcome:\n${run.prompt.slice(0, 4000)}\n\nPrevious result:\n${run.result.slice(0, 4000)}\n\nChecks: ${run.verification ? `${run.verification.command}: ${run.verification.result.success ? 'passed for the recorded tree only' : 'failed'}` : 'Not recorded'}\n\nPreserve unrelated and uncommitted work. Check the current diff, requirements, configured checks, repository contribution rules, and delivery configuration. Prepare concrete changes and a reviewable handoff with exact branch, environment, commands and expected effects. Do not commit, push, open or merge a PR, deploy, send messages, or change remote state until the user explicitly approves that concrete action. Report local integration, remote publication, CI results and deployed behavior separately, with evidence and remaining uncertainties.`;
}

export function TaskDelivery({
  run,
  integrated = false,
  onHandoff,
  onReview,
}: {
  run: TaskRun;
  integrated?: boolean;
  onHandoff: (text: string) => void | Promise<void>;
  onReview?: () => void;
}) {
  const [status, setStatus] = useState<DeliveryStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inspect = async (remote: boolean) => {
    setBusy(true);
    setError('');
    try {
      setStatus(
        await nativeTask<DeliveryStatus>('task_delivery_status', {
          id: run.id,
          project: integrated,
          remote,
        }),
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const prepare = async (goal: string) => {
    setError('');
    try {
      await onHandoff(deliveryHandoff(run, integrated, goal));
    } catch (cause) {
      setError(String(cause));
    }
  };
  return (
    <section className="task-delivery space-y-4" aria-label="Delivery">
      <p>
        {integrated
          ? 'Merged locally. Choose what to prepare next.'
          : 'Review and merge the changes above before publishing.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {onReview && !integrated && <Button onClick={onReview}>Review changes</Button>}
        <Button variant="outline" disabled={busy} onClick={() => void inspect(false)}>
          Check local status
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          loading={busy}
          loadingLabel="Inspecting…"
          onClick={() => void inspect(true)}
        >
          Check PR and CI
        </Button>
      </div>
      {status && (
        <>
          <DefinitionList
            items={[
              { label: 'Inspected branch', value: status.branch || 'Detached HEAD' },
              { label: 'Local revision', value: status.head.slice(0, 12) },
              {
                label: 'Uncommitted changes',
                value: status.changed ? 'Present' : 'None at inspection',
              },
              {
                label: 'Local upstream reference',
                value: status.upstream
                  ? `${status.upstream} · ${status.ahead ?? '?'} ahead / ${status.behind ?? '?'} behind`
                  : 'Not configured',
              },
              { label: 'Deployment', value: 'Not verified' },
            ]}
          />
          <p className="task-muted">
            {status.remoteNote} Checked {new Date(status.checkedAt).toLocaleString()}.
          </p>
          {status.pullRequest && (
            <div className="space-y-2">
              <Button
                variant="outline"
                onClick={() =>
                  void openExternalUrl(status.pullRequest?.url ?? '').catch((cause) =>
                    setError(String(cause)),
                  )
                }
              >
                Open PR · {status.pullRequest.state}
              </Button>
              {status.pullRequest.headRefOid !== status.head && (
                <InlineNotice>
                  The PR head differs from the inspected local revision. Its checks do not verify
                  this local result.
                </InlineNotice>
              )}
              <Disclosure>
                <DisclosureSummary>
                  CI checks ({status.pullRequest.statusCheckRollup?.length ?? 0})
                </DisclosureSummary>
                {status.pullRequest.statusCheckRollup?.length ? (
                  <ul>
                    {status.pullRequest.statusCheckRollup.map((check) => (
                      <li key={check.name || check.context || 'Check'}>
                        {check.name || check.context || 'Check'} ·{' '}
                        {check.conclusion || check.state || check.status || 'Unknown'}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No CI checks reported.</p>
                )}
              </Disclosure>
            </div>
          )}
        </>
      )}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void prepare('a pull request')}>
            <GitPullRequest size={16} aria-hidden="true" /> Prepare pull request
          </Button>
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button variant="outline">
                More delivery actions <ChevronDown size={16} aria-hidden="true" />
              </Button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content
                className="workspace-menu"
                align="start"
                sideOffset={8}
                collisionPadding={12}
              >
                {['CI verification', 'a deployment'].map((goal) => (
                  <Menu.Item
                    key={goal}
                    className="workspace-menu-item"
                    onSelect={() => void prepare(goal)}
                  >
                    Prepare {goal}
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </div>
        <p className="task-muted">Prepares a draft for your review. Nothing is published.</p>
        <CopyButton
          text={deliveryHandoff(run, integrated, 'a delivery handoff')}
          label="Copy delivery handoff"
        />
      </div>
    </section>
  );
}
