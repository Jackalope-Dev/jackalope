import { Checkbox, Disclosure, DisclosureSummary } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { type RefObject, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  authorFollowUp,
  type MergedFinding,
  mergeFindings,
  reviewerReport,
} from '../../lib/challenge-review';
import { authorOf, rankReviewers } from '../../lib/reviewer-choice';
import { isActive, nativeTask, type TaskRun } from '../../lib/task-runtime';
import { selectWork } from '../../lib/work-selection';
import { syncAgentConfig } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import { agentAccountFor, useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogFooter, DialogHeader } from '../ui/Dialog';
import { FormField } from '../ui/FormField';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import { agentAdapter } from './CrossModelReviewPanel';
import './challenge-review.css';

const NONE = 'none';

interface CommandResult {
  exitCode: number | null;
  success: boolean;
  timedOut: boolean;
  stalled?: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
}
interface Rerun {
  command: string;
  preparation: CommandResult | null;
  result: CommandResult | null;
}

/** Chooses one or two Challenge reviewers and starts them on an explicit click. */
export function ChallengeDialog({
  run,
  returnFocus,
  onClose,
  onStarted,
}: {
  run: TaskRun;
  returnFocus?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onStarted: () => void;
}) {
  const runners = useExecutionStore((state) => state.runners);
  const project = useProjectStore((state) => state.projects.find((p) => p.id === run.projectId));
  const ranked = useMemo(() => rankReviewers(runners, authorOf(run), agentAdapter), [runners, run]);
  const [first, setFirst] = useState(ranked[0]?.id ?? '');
  const [second, setSecond] = useState(NONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = (id: string) => runners.find((runner) => runner.id === id)?.name ?? id;
  const start = async () => {
    const agents = [first, second].filter((agent) => agent && agent !== NONE);
    if (!agents.length || busy) return;
    setBusy(true);
    setError('');
    const failures: string[] = [];
    try {
      await syncAgentConfig();
      for (const agent of agents)
        try {
          await nativeTask<string>('task_start_challenge', {
            sourceRunId: run.id,
            request: {
              id: crypto.randomUUID(),
              projectId: run.projectId,
              projectName: run.projectName,
              projectPath: run.projectPath,
              agent,
              agentProfileId: agentAccountFor(project, agentAdapter(agent)),
              prompt: '',
              isolated: true,
              targetBranch: run.targetBranch ?? project?.preferences?.baseBranch,
              verifyCommand: run.verifyCommand ?? project?.preferences?.verifyCommand,
              prepareCommand: run.prepareCommand ?? project?.preferences?.prepareCommand,
              setupFiles: run.setupFiles ?? project?.preferences?.setupFiles,
              autoVerify: false,
              effort: 'balanced',
            },
          });
        } catch (cause) {
          failures.push(`${name(agent)}: ${String(cause)}`);
        }
      await useExecutionStore.getState().refresh();
      if (failures.length < agents.length) onStarted();
      if (failures.length) setError(failures.join(' '));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="challenge-dialog"
        onCloseAutoFocus={(event) => {
          if (!returnFocus?.current) return;
          event.preventDefault();
          returnFocus.current.focus();
        }}
      >
        <DialogCloseButton disabled={busy} />
        <DialogHeader
          title="Challenge this change"
          description="Each reviewer tries to break the change in its own copy of these files and reports only failures it reproduced. Reviewers use their agent’s account and quota."
        />
        <form
          className="challenge-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          {ranked.length ? (
            <>
              <FormField label="Reviewer">
                <Select value={first} onValueChange={setFirst} disabled={busy}>
                  {ranked.map((runner) => (
                    <SelectItem key={runner.id} value={runner.id}>
                      {runner.name}
                    </SelectItem>
                  ))}
                </Select>
              </FormField>
              <FormField label="Second reviewer (optional)">
                <Select value={second} onValueChange={setSecond} disabled={busy}>
                  <SelectItem value={NONE}>None</SelectItem>
                  {ranked
                    .filter((runner) => runner.id !== first)
                    .map((runner) => (
                      <SelectItem key={runner.id} value={runner.id}>
                        {runner.name}
                      </SelectItem>
                    ))}
                </Select>
              </FormField>
            </>
          ) : (
            <InlineNotice tone="warning">
              Connect an agent in Agents to challenge work.
            </InlineNotice>
          )}
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !first} loading={busy} loadingLabel="Starting…">
              Start challenge
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog.Root>
  );
}

function rerunSummary(rerun: Rerun) {
  const { preparation, result } = rerun;
  if (preparation && !preparation.success)
    return preparation.timedOut || preparation.stalled
      ? 'Project setup was stopped before it finished, so the command did not run.'
      : `Project setup failed (exit ${preparation.exitCode ?? 'unknown'}), so the command did not run.`;
  if (!result) return 'The command did not run.';
  const seconds = (result.durationMs / 1000).toFixed(1);
  if (result.timedOut || result.stalled) return `Stopped after ${seconds} seconds.`;
  return `Exited with code ${result.exitCode ?? 'unknown'} in ${seconds} seconds.`;
}

function FindingCard({
  finding,
  selected,
  onSelect,
  agentName,
}: {
  finding: MergedFinding;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  agentName: (agent: string) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rerun, setRerun] = useState<Rerun | null>(null);
  const runAgain = async () => {
    setBusy(true);
    setError('');
    try {
      setRerun(
        await nativeTask<Rerun>('task_challenge_rerun', {
          id: finding.sources[0].runId,
          command: finding.command,
        }),
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const output = rerun?.result ?? rerun?.preparation;
  return (
    <li className="challenge-finding">
      <label className="challenge-finding-title">
        <Checkbox checked={selected} onChange={(event) => onSelect(event.target.checked)} />
        <span>{finding.title}</span>
      </label>
      <p className="task-muted text-sm">
        Found by {finding.sources.map((source) => agentName(source.agent)).join(' and ')}
      </p>
      <dl className="challenge-finding-proof">
        <dt>Command</dt>
        <dd>
          <code>{finding.command}</code>
        </dd>
        <dt>Printed</dt>
        <dd>
          <pre>{finding.output}</pre>
        </dd>
        {finding.expected && (
          <>
            <dt>Expected</dt>
            <dd>{finding.expected}</dd>
          </>
        )}
        {finding.breaks && (
          <>
            <dt>Breaks the intent</dt>
            <dd>{finding.breaks}</dd>
          </>
        )}
      </dl>
      <div className="challenge-finding-actions">
        <Button
          variant="outline"
          disabled={busy}
          loading={busy}
          loadingLabel="Running…"
          onClick={() => void runAgain()}
        >
          Run again
        </Button>
        {rerun && (
          <p role="status" className="task-muted text-sm">
            {rerunSummary(rerun)}
          </p>
        )}
      </div>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {output && (
        <Disclosure>
          <DisclosureSummary className="task-summary">Output from the new run</DisclosureSummary>
          {output.truncated && <p className="task-muted">Output was shortened.</p>}
          <pre className="challenge-rerun-output">
            {`${output.stdout}\n${output.stderr}`.trim() || '(no output)'}
          </pre>
        </Disclosure>
      )}
    </li>
  );
}

/** Challenge reviewers of this result and their merged findings. */
export function ChallengeFindings({
  run,
  onCorrect,
}: {
  run: TaskRun;
  onCorrect?: (prompt: string) => void | Promise<void>;
}) {
  const reviewers = useExecutionStore(
    useShallow((state) =>
      state.runs
        .filter((candidate) => candidate.challengeOf?.runId === run.id)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    ),
  );
  const runners = useExecutionStore((state) => state.runners);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const finishedKey = reviewers
    .filter((reviewer) => !isActive(reviewer))
    .map((reviewer) => `${reviewer.id}:${reviewer.endedAt}`)
    .join('|');
  useEffect(() => {
    if (!finishedKey) return;
    let alive = true;
    for (const entry of finishedKey.split('|')) {
      const id = entry.slice(0, entry.indexOf(':'));
      nativeTask<string>('task_challenge_reply', { id })
        .then((reply) => {
          if (alive) setReplies((current) => ({ ...current, [id]: reply }));
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [finishedKey]);
  const agentName = (agent: string) => runners.find((runner) => runner.id === agent)?.name ?? agent;
  const finished = reviewers.filter(
    (reviewer) => !isActive(reviewer) && ['review', 'reviewed'].includes(reviewer.status),
  );
  const reports = finished.map((reviewer) => ({
    run: reviewer,
    report: reviewerReport(reviewer, replies[reviewer.id]),
  }));
  const findings = mergeFindings(reports);
  const dropped = reports.filter(({ report }) => report.dropped > 0);
  const droppedTotal = dropped.reduce((total, { report }) => total + report.dropped, 0);
  const unreadable = reports.filter(
    ({ run: reviewer, report }) => !report.structured && replies[reviewer.id] !== undefined,
  );
  const running = reviewers.some(isActive);
  const chosen = findings.filter((finding) => !excluded.has(finding.key));
  if (!reviewers.length) return null;
  const send = async () => {
    if (!onCorrect || !chosen.length) return;
    setSending(true);
    setError('');
    try {
      await onCorrect(authorFollowUp(chosen, agentName));
      document.getElementById('task-reply')?.focus();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSending(false);
    }
  };
  return (
    <section className="task-verification challenge-review" aria-label="Challenge review">
      <div className="challenge-review-heading">
        <h3 className="font-medium">Challenge</h3>
        {findings.length > 0 && (
          <Button
            disabled={!onCorrect || !chosen.length || sending}
            loading={sending}
            loadingLabel="Adding…"
            onClick={() => void send()}
          >
            Send to the author
            {chosen.length > 0 && <span className="ui-segment-count">{chosen.length}</span>}
          </Button>
        )}
      </div>
      <ul className="challenge-reviewers" aria-label="Reviewers">
        {reviewers.map((reviewer) => (
          <li key={reviewer.id}>
            <span>
              {agentName(reviewer.agent)}
              <span className="task-muted">
                {' · '}
                {isActive(reviewer)
                  ? 'Reviewing…'
                  : ['review', 'reviewed'].includes(reviewer.status)
                    ? 'Finished'
                    : `Did not finish${reviewer.error ? `: ${reviewer.error}` : ''}`}
              </span>
            </span>
            <Button variant="ghost" onClick={() => selectWork({ task: reviewer.id })}>
              Open
            </Button>
          </li>
        ))}
      </ul>
      {!onCorrect && findings.length > 0 && (
        <p className="task-muted text-sm">
          This attempt can’t take a follow-up, so findings can’t be sent from here.
        </p>
      )}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {findings.length > 0 ? (
        <ol className="challenge-findings" aria-label="Proven findings">
          {findings.map((finding) => (
            <FindingCard
              key={finding.key}
              finding={finding}
              agentName={agentName}
              selected={!excluded.has(finding.key)}
              onSelect={(selected) =>
                setExcluded((current) => {
                  const next = new Set(current);
                  if (selected) next.delete(finding.key);
                  else next.add(finding.key);
                  return next;
                })
              }
            />
          ))}
        </ol>
      ) : (
        finished.length > 0 &&
        !running &&
        unreadable.length < finished.length && <p role="status">No proven findings.</p>
      )}
      {running && <p className="task-muted text-sm">Findings appear as each reviewer finishes.</p>}
      {droppedTotal > 0 && (
        <p className="task-muted text-sm">
          Dropped {droppedTotal} {droppedTotal === 1 ? 'finding' : 'findings'} reported without a
          command and its output (
          {dropped
            .map(({ run: reviewer, report }) => `${agentName(reviewer.agent)} ${report.dropped}`)
            .join(', ')}
          ).
        </p>
      )}
      {unreadable.map(({ run: reviewer }) => (
        <Disclosure key={reviewer.id}>
          <DisclosureSummary className="task-summary">
            {agentName(reviewer.agent)} didn’t report findings in a form Jackalope can read. Show
            its reply
          </DisclosureSummary>
          <pre className="challenge-rerun-output">{replies[reviewer.id] || '(no reply)'}</pre>
        </Disclosure>
      ))}
    </section>
  );
}
