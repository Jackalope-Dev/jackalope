import {
  Badge,
  Button,
  Checkbox,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Disclosure,
  DisclosureSummary,
  InlineNotice,
  Select,
  SelectItem,
  Switch,
  Textarea,
} from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Circle, CircleCheck, Loader2, ScanSearch, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  type AgentReviewReport,
  findingLocation,
  fixFollowUp,
  type ReviewFinding,
  reviewBlock,
  reviewState,
  taskReviews,
} from '../../lib/agent-review';
import { agentAdapter } from '../../lib/agents';
import { invokeNative } from '../../lib/native/transport';
import { authorOf, rankReviewers } from '../../lib/reviewer-choice';
import { durationLabel, elapsedLabel } from '../../lib/run-status';
import type { TaskRun } from '../../lib/run-types';
import { liveActivity } from '../../lib/task-live-activity';
import { useExecutionStore } from '../../stores/executionStore';
import { agentAccountFor, useProjectStore } from '../../stores/projectStore';
import { TaskActivity } from './TaskActivity';
import './agent-review.css';
import { describeError } from '../../lib/errors';
import { stopTask } from '../../lib/task-client';
import { ActionError } from '../ui/ActionError';

const SEVERITY = {
  high: { label: 'High', variant: 'danger' },
  medium: { label: 'Medium', variant: 'warning' },
  low: { label: 'Low', variant: 'default' },
} as const;

/**
 * Reviews this attempt with another agent in place: one click starts it, a dialog
 * follows its steps, and the chosen fixes continue this task with its author.
 */
export function AgentReview({
  run,
  verifyCommand,
  onApply,
  onCorrect,
}: {
  run: TaskRun;
  verifyCommand?: string;
  /** Continues this task with the prompt; absent when the attempt can't take a follow-up. */
  onApply?: (prompt: string) => Promise<void>;
  /** Adds the prompt to the reply instead, where continuing isn't available here. */
  onCorrect?: (prompt: string) => void | Promise<void>;
}) {
  const runs = useExecutionStore((state) => state.runs);
  const runners = useExecutionStore((state) => state.runners);
  const project = useProjectStore((state) => state.projects.find((p) => p.id === run.projectId));
  const reviewer = useMemo(
    () => taskReviews(runs, run.taskId).find((review) => review.challengeOf?.runId === run.id),
    [runs, run.taskId, run.id],
  );
  const ranked = useMemo(() => rankReviewers(runners, authorOf(run), agentAdapter), [runners, run]);
  const [choice, setChoice] = useState('');
  const agent = ranked.some((runner) => runner.id === choice) ? choice : (ranked[0]?.id ?? '');
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const name = (id: string) => runners.find((runner) => runner.id === id)?.name ?? id;

  const start = async () => {
    if (!agent || starting) return;
    setStarting(true);
    setError('');
    setOpen(true);
    try {
      await invokeNative<string>('task_start_agent_review', {
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
          setupFiles: run.setupFiles ?? project?.preferences?.setupFiles,
          autoVerify: false,
          effort: 'balanced',
        },
      });
      await useExecutionStore.getState().refresh();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setStarting(false);
    }
  };

  const state = reviewer ? reviewState(reviewer) : null;
  const report = useReviewReport(reviewer);
  const count = report?.findings.length ?? 0;
  return (
    <>
      {reviewer ? (
        <Button variant="outline" onClick={() => setOpen(true)}>
          {state === 'running' ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <ScanSearch size={16} aria-hidden="true" />
          )}
          {state === 'running'
            ? 'Reviewing…'
            : state === 'failed'
              ? 'Review stopped'
              : report && !count
                ? 'No issues found'
                : 'Agent review'}
          {state === 'finished' && count > 0 && <span className="ui-segment-count">{count}</span>}
        </Button>
      ) : (
        <Button
          variant="outline"
          disabled={!agent || starting}
          title={agent ? `Review with ${name(agent)}` : 'Connect an agent in Agents to review'}
          onClick={() => void start()}
        >
          <ScanSearch size={16} aria-hidden="true" /> Agent review
        </Button>
      )}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <DialogContent className="agent-review-dialog" contained>
          <DialogCloseButton />
          <DialogHeader
            title="Agent review"
            description={
              reviewer
                ? state === 'failed'
                  ? `${name(reviewer.agent)} didn’t finish the review.`
                  : `${name(reviewer.agent)} ${state === 'running' ? 'is reading' : 'read'} these changes without running them.`
                : agent
                  ? `Starting ${name(agent)}…`
                  : undefined
            }
          />
          {reviewer && state ? (
            <ReviewBody
              key={reviewer.id}
              reviewer={reviewer}
              state={state}
              report={report}
              verifyCommand={verifyCommand}
              onApply={onApply}
              onCorrect={onCorrect}
              onDone={() => setOpen(false)}
              restart={
                <div className="agent-review-restart">
                  {ranked.length > 1 && (
                    <Select value={agent} onValueChange={setChoice} aria-label="Reviewer">
                      {ranked.map((runner) => (
                        <SelectItem key={runner.id} value={runner.id}>
                          {runner.name}
                        </SelectItem>
                      ))}
                    </Select>
                  )}
                  <Button
                    variant="outline"
                    disabled={!agent || starting}
                    onClick={() => void start()}
                  >
                    Review again
                  </Button>
                </div>
              }
            />
          ) : (
            <div className="agent-review-body">
              {error ? (
                <InlineNotice tone="error">{error}</InlineNotice>
              ) : (
                <Steps steps={[{ label: 'Snapshot the changes', status: 'active' }]} />
              )}
            </div>
          )}
          {error && reviewer && (
            <InlineNotice tone="error" className="agent-review-error">
              {error}
            </InlineNotice>
          )}
        </DialogContent>
      </Dialog.Root>
    </>
  );
}

/** The reviewer's parsed report once its reply is read; null when it has no readable block. */
function useReviewReport(reviewer: TaskRun | undefined) {
  const [replies, setReplies] = useState<Record<string, string>>({});
  const finished = reviewer && reviewState(reviewer) === 'finished';
  const id = reviewer?.id;
  useEffect(() => {
    if (!finished || !id) return;
    let alive = true;
    invokeNative<string>('task_challenge_reply', { id })
      .then((reply) => {
        if (alive) setReplies((current) => ({ ...current, [id]: reply }));
      })
      .catch(() => {
        if (alive) setReplies((current) => ({ ...current, [id]: '' }));
      });
    return () => {
      alive = false;
    };
  }, [finished, id]);
  if (!id || replies[id] === undefined) return undefined;
  const reply = replies[id];
  const block = reviewBlock(reply);
  const report: AgentReviewReport & { reply: string; unreadable: boolean } = {
    summary: block?.summary ?? '',
    findings: block?.findings ?? [],
    reply,
    unreadable: !block,
  };
  return report;
}

type Step = { label: string; status: 'done' | 'active' | 'waiting' | 'failed'; detail?: string };

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="agent-review-steps" aria-label="Review steps">
      {steps.map((step) => (
        <li key={step.label} data-status={step.status}>
          <span className="agent-review-step-mark" aria-hidden="true">
            {step.status === 'done' ? (
              <Check size={14} />
            ) : step.status === 'active' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : step.status === 'failed' ? (
              <X size={14} />
            ) : (
              <Circle size={10} />
            )}
          </span>
          <span className="agent-review-step-text">
            <span>
              {step.label}
              <span className="sr-only">
                {
                  {
                    done: ' (done)',
                    active: ' (in progress)',
                    waiting: ' (waiting)',
                    failed: ' (failed)',
                  }[step.status]
                }
              </span>
            </span>
            {step.detail && <span className="agent-review-step-detail">{step.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ReviewBody({
  reviewer,
  state,
  report,
  verifyCommand,
  onApply,
  onCorrect,
  onDone,
  restart,
}: {
  reviewer: TaskRun;
  state: ReturnType<typeof reviewState>;
  report: ReturnType<typeof useReviewReport>;
  verifyCommand?: string;
  onApply?: (prompt: string) => Promise<void>;
  onCorrect?: (prompt: string) => void | Promise<void>;
  onDone: () => void;
  restart: ReactNode;
}) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [check, setCheck] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const live = liveActivity(reviewer);
  const findings = report?.findings ?? [];
  const chosen = findings.filter((finding) => !excluded.has(finding.key));
  const unreadable = !!report?.unreadable;
  const handoff = onApply ?? onCorrect;
  const stop = async () => {
    try {
      await stopTask(reviewer.id);
      await useExecutionStore.getState().refresh();
    } catch (cause) {
      setError(describeError(cause));
    }
  };
  const send = async () => {
    if (!handoff || sending) return;
    const prompt = unreadable
      ? `An agent review of your change said:\n\n${report.reply.slice(0, 8_000)}\n\nApply the fixes it suggests that hold up against the code, and say which you skipped and why.${note.trim() ? `\n\nFrom me:\n${note.trim()}` : ''}`
      : fixFollowUp(chosen, { note, check: check ? verifyCommand : undefined });
    setSending(true);
    setError('');
    try {
      await handoff(prompt);
      onDone();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSending(false);
    }
  };

  if (state !== 'finished' || !report) {
    const failed = state === 'failed';
    const steps: Step[] = [
      { label: 'Snapshot the changes', status: 'done' },
      {
        label: 'Read the changes',
        status: failed ? 'failed' : state === 'finished' || reviewer.finishing ? 'done' : 'active',
        detail: failed
          ? reviewer.error || 'The reviewer stopped before it finished.'
          : live && live.current !== live.phase
            ? live.current
            : undefined,
      },
      {
        label: 'Write up suggestions',
        status: state === 'finished' || reviewer.finishing ? 'active' : 'waiting',
      },
    ];
    return (
      <>
        <div className="agent-review-body">
          <Steps steps={steps} />
          {state === 'running' && (
            <p className="task-muted text-sm" role="status">
              {elapsedLabel(reviewer.startedAt)} so far. You can close this; the review keeps going.
            </p>
          )}
          <ActionError error={error} />
          <ReviewerActivity reviewer={reviewer} />
        </div>
        <DialogFooter>
          {failed ? (
            restart
          ) : (
            <Button variant="outline" onClick={() => void stop()}>
              Stop review
            </Button>
          )}
        </DialogFooter>
      </>
    );
  }

  const took = reviewer.durationMs ? ` in ${durationLabel(reviewer.durationMs / 1000)}` : '';
  return (
    <>
      <div className="agent-review-body">
        {report.summary && <p className="agent-review-summary">{report.summary}</p>}
        {unreadable ? (
          <>
            <InlineNotice tone="warning">
              The reviewer didn’t list its suggestions in a form Jackalope can read. Its reply is
              below; you can still send it to the author.
            </InlineNotice>
            <pre className="agent-review-reply">{report.reply || '(no reply)'}</pre>
          </>
        ) : findings.length ? (
          <section aria-label="Suggestions" className="agent-review-findings">
            <div className="agent-review-findings-heading">
              <h3>
                {findings.length} {findings.length === 1 ? 'suggestion' : 'suggestions'}
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setExcluded(chosen.length ? new Set(findings.map((item) => item.key)) : new Set())
                }
              >
                {chosen.length ? 'Clear selection' : 'Select all'}
              </Button>
            </div>
            <ol>
              {findings.map((finding) => (
                <FindingCard
                  key={finding.key}
                  finding={finding}
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
          </section>
        ) : (
          <div className="agent-review-clear" role="status">
            <CircleCheck size={20} aria-hidden="true" />
            <span>No issues found{took}.</span>
          </div>
        )}
        {!handoff && findings.length > 0 && (
          <p className="task-muted text-sm">
            This attempt can’t take a follow-up, so fixes can’t be sent from here.
          </p>
        )}
        <ActionError error={error} />
        <ReviewerActivity reviewer={reviewer} />
      </div>
      {handoff && (unreadable || findings.length > 0) && (
        <div className="agent-review-handoff">
          <Textarea
            aria-label="Anything to add for the agent (optional)"
            placeholder="Anything to add? (optional)"
            rows={1}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          {verifyCommand && !unreadable && (
            <div className="agent-review-check">
              <Switch checked={check} onCheckedChange={setCheck} label="Run checks when done" />
              <span>
                Run checks when done <code>{verifyCommand}</code>
              </span>
            </div>
          )}
        </div>
      )}
      <DialogFooter className="agent-review-footer">
        {restart}
        {handoff && (unreadable || findings.length > 0) ? (
          <Button
            disabled={sending || (!unreadable && !chosen.length)}
            loading={sending}
            loadingLabel={onApply ? 'Starting…' : 'Adding…'}
            onClick={() => void send()}
          >
            {onApply ? 'Make these changes' : 'Add to reply'}
            {!unreadable && <span className="ui-segment-count">{chosen.length}</span>}
          </Button>
        ) : (
          <Button onClick={onDone}>Done</Button>
        )}
      </DialogFooter>
    </>
  );
}

function FindingCard({
  finding,
  selected,
  onSelect,
}: {
  finding: ReviewFinding;
  selected: boolean;
  onSelect: (selected: boolean) => void;
}) {
  const severity = SEVERITY[finding.severity];
  const location = findingLocation(finding);
  return (
    <li className="agent-review-finding" data-selected={selected || undefined}>
      <label className="agent-review-finding-title">
        <Checkbox checked={selected} onChange={(event) => onSelect(event.target.checked)} />
        <span>{finding.title}</span>
        <Badge variant={severity.variant}>{severity.label}</Badge>
      </label>
      {location && <code className="agent-review-location">{location}</code>}
      {finding.problem && <p>{finding.problem}</p>}
      {finding.fix && (
        <div className="agent-review-fix">
          <span>Fix</span>
          <p>{finding.fix}</p>
        </div>
      )}
    </li>
  );
}

function ReviewerActivity({ reviewer }: { reviewer: TaskRun }) {
  if (!reviewer.activity.length) return null;
  return (
    <Disclosure>
      <DisclosureSummary className="task-summary">Reviewer activity</DisclosureSummary>
      <TaskActivity entries={reviewer.activity} active={reviewState(reviewer) === 'running'} />
    </Disclosure>
  );
}
