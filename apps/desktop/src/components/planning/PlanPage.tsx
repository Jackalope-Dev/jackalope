import {
  Badge,
  Button,
  EmptyState,
  InlineNotice,
  Input,
  LoadingState,
  Select,
  SelectItem,
  Textarea,
} from '@jackalope/ui';
import { ClipboardList, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { agentAdapter } from '../../lib/agent-catalog';
import { navigateWorkspace, openProjectSettings } from '../../lib/app-events';
import { runHostName } from '../../lib/computers';
import {
  type AutonomyEntry,
  approvalVerification,
  areaStateLabels,
  criterionCoverage,
  criterionStateLabels,
  interviewOptions,
  type PlanRounds,
  type PlanShape,
  type PlanSummary,
  type PlanView,
  planAssumption,
  planCommands,
  type RoundAssignment,
  roundStateLabels,
  type SectionChange,
  shapeChoices,
  stateTone,
  statusLabels,
  taskStateLabels,
  taskWaves,
} from '../../lib/plan-mode';
import { planReviewer } from '../../lib/reviewer-choice';
import { respondToPrompt } from '../../lib/task-client';
import { selectWork } from '../../lib/work-selection';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import { usePlanStore } from '../../stores/planStore';
import { useActiveProject, useProjectStore } from '../../stores/projectStore';
import { HostCapacity } from '../computers/HostCapacity';
import { EscalationNote } from '../tasks/AgentDecision';
import { AgentQuestion } from '../tasks/AgentQuestion';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import { WorkspaceTabs } from '../ui/WorkspaceTabs';
import { PlanAutonomyPanel } from './PlanAutonomy';
import './plan-page.css';
import { describeError } from '../../lib/errors';
import { useAction } from '../../lib/useAction';
import { useNativeResource } from '../../lib/useNativeResource';
import { ActionError } from '../ui/ActionError';

type Tab = 'plan' | 'progress' | 'revisions';
const toneVariant = {
  success: 'success',
  danger: 'danger',
  accent: 'accent',
  muted: 'default',
} as const;

function StateBadge({ state, label }: { state: string; label: string }) {
  return <Badge variant={toneVariant[stateTone(state)]}>{label}</Badge>;
}

function BetaBadge() {
  return <Badge variant="accent">Beta</Badge>;
}

function Bullets({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="plan-muted">{empty}</p>;
  return (
    <ul className="plan-bullets">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/** Facts the planner checked in the code, with their evidence, apart from its own choices. */
function Assumptions({ items }: { items: string[] }) {
  if (!items.length) return <p className="plan-muted">None recorded.</p>;
  return (
    <ul className="plan-assumptions">
      {items.map((raw) => {
        const item = planAssumption(raw);
        return (
          <li key={raw}>
            <Badge variant={item.checked ? 'success' : 'default'}>
              {item.checked ? 'Checked' : 'Assumed'}
            </Badge>
            <span>
              {item.text}
              {item.checked && (
                <span className="plan-evidence">{item.evidence || 'No evidence recorded'}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function PlanPage() {
  const project = useActiveProject();
  const { selectedId, select } = usePlanStore();
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [view, setView] = useState<PlanView | null>(null);
  const { run: act, error, setError } = useAction(() => Promise.all([load(), loadList()]));
  const runs = useExecutionStore((state) => state.runs);

  const loadList = useCallback(async () => {
    if (!project) return;
    try {
      const result = await planCommands.list(project.id);
      setPlans(result.plans);
      setProblems(result.problems);
    } catch (cause) {
      setError(describeError(cause));
      setPlans([]);
    }
  }, [project, setError]);
  useEffect(() => {
    void loadList();
  }, [loadList]);

  const current = selectedId ?? plans?.[0]?.id ?? null;
  const loading = useRef(false);
  const load = useCallback(async () => {
    if (!current || loading.current) return;
    loading.current = true;
    try {
      setView(await planCommands.get(current));
      setError('');
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      loading.current = false;
    }
  }, [current, setError]);
  // Planning and delivery move with task attempts, so re-read when runs change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs is the change signal
  useEffect(() => {
    void load();
  }, [load, runs]);

  if (!project)
    return (
      <WorkspacePage>
        <WorkspaceHeading title="Plans" />
        <EmptyState icon={ClipboardList} title="Choose a project to see its plans" />
      </WorkspacePage>
    );

  return (
    <WorkspacePage className="plan-page">
      <WorkspaceHeading
        title="Plans"
        description="Plan with an agent or write the plan yourself, then approve it before code changes."
        action={
          <Button variant="outline" onClick={() => openProjectSettings(project.id, 'Project')}>
            <Settings2 size={16} />
            Planning settings
          </Button>
        }
      />
      {problems.map((problem) => (
        <InlineNotice key={problem} tone="warning">
          {problem}
        </InlineNotice>
      ))}
      {plans === null ? (
        <LoadingState compact label="Loading plans…" />
      ) : !plans.length ? (
        <EmptyState
          icon={ClipboardList}
          title="No plans yet"
          description="Write a request in the Work composer and choose Options → Plan with me, or choose Plan feature work from the Work menu to write the plan yourself."
          action={
            <Button
              onClick={() => {
                selectWork();
                navigateWorkspace('kanban');
              }}
            >
              Open the composer
            </Button>
          }
        />
      ) : (
        <div className="plan-layout">
          <nav className="plan-list" aria-label="Plans">
            {plans.map((plan) => (
              <button
                key={plan.id}
                type="button"
                className="plan-list-row"
                aria-current={plan.id === current || undefined}
                onClick={() => select(plan.id)}
              >
                <span className="plan-list-title">{plan.title}</span>
                <span className="plan-muted">
                  {plan.needsYou ? (
                    <Badge variant="warning">Needs you</Badge>
                  ) : (
                    (statusLabels[plan.status] ?? plan.status)
                  )}
                  {plan.revision ? ` · r${plan.revision}` : ''}
                </span>
              </button>
            ))}
          </nav>
          <div className="plan-detail">
            <ActionError error={error} />
            {view && view.id === current ? (
              <PlanDetail view={view} act={act} />
            ) : (
              <LoadingState compact label="Opening plan…" />
            )}
          </div>
        </div>
      )}
    </WorkspacePage>
  );
}

function PlanDetail({
  view,
  act,
}: {
  view: PlanView;
  act: (work: () => Promise<unknown>) => Promise<unknown>;
}) {
  const [tab, setTab] = useState<Tab>(view.progress ? 'progress' : 'plan');
  const pending = view.deviations.filter((deviation) => deviation.status === 'pending');
  const deciding = pending.length > 0 && pending.every((deviation) => deviation.agentDeciding);
  /** Why a deviation came to the person although an agent could have accepted it. */
  const escalation = (id: string) =>
    view.autonomy?.entries.find(
      (entry) => entry.deviationId === id && entry.outcome === 'escalated' && entry.reason,
    );
  return (
    <section className="plan-detail-body" aria-labelledby="plan-title">
      <header className="plan-detail-header">
        <div>
          <h2 id="plan-title">{view.document?.title ?? view.title}</h2>
          <p className="plan-muted">
            {statusLabels[view.status]}
            {view.revision ? ` · revision ${view.revision}` : ''}
            {view.approval ? ` · approved by ${view.approval.approvedBy}` : ''}
            {view.rounds && (
              <span className="plan-swarm">
                {' '}
                · Swarm round {view.rounds.current} of {view.rounds.max} <BetaBadge />
              </span>
            )}
          </p>
        </div>
      </header>
      {view.error && <InlineNotice tone="warning">{view.error}</InlineNotice>}
      {pending.length > 0 && (
        <section className="plan-needs-you" aria-labelledby="plan-needs-you">
          <WorkspaceSectionHeading
            title={deciding ? 'An agent is deciding' : 'Needs you'}
            titleId="plan-needs-you"
            description={
              deciding
                ? 'An agent is checking whether this stays within the plan. Dependent tasks wait; you can still decide.'
                : 'The work departed from the approved plan. Dependent tasks are paused until you decide.'
            }
          />
          {pending.map((deviation) => (
            <InlineNotice
              key={deviation.id}
              tone="warning"
              action={
                <div className="plan-actions">
                  <Button
                    variant="outline"
                    onClick={() =>
                      void act(() => planCommands.resolveDeviation(view.id, deviation.id, 'accept'))
                    }
                  >
                    Accept and amend
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void act(() => planCommands.resolveDeviation(view.id, deviation.id, 'redo'))
                    }
                  >
                    Redo
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void act(() => planCommands.resolveDeviation(view.id, deviation.id, 'replan'))
                    }
                  >
                    Re-plan
                  </Button>
                </div>
              }
            >
              {deviation.agentDeciding && <Badge variant="accent">Agent deciding</Badge>}{' '}
              <strong>{deviationKinds[deviation.kind]}</strong> {deviation.summary}
              {deviation.amendment && <p>Proposed amendment: {deviation.amendment}</p>}
              {!deviation.agentDeciding &&
                (() => {
                  const sent = escalation(deviation.id);
                  return sent?.reason ? (
                    <EscalationNote category={sent.category ?? 'decider'} reason={sent.reason} />
                  ) : null;
                })()}
            </InlineNotice>
          ))}
        </section>
      )}
      {view.autonomy && (
        <PlanAutonomyPanel
          planId={view.id}
          autonomy={view.autonomy}
          onChanged={async () => {
            await act(async () => {});
          }}
        />
      )}
      {view.questions.map((prompt) => {
        const { choices, stops } = interviewOptions(prompt);
        return (
          <AgentQuestion
            key={prompt.id}
            prompt={{ ...prompt, options: [...choices, ...stops] }}
            active
            agentName="The planner"
            onAnswer={async (answer) => {
              await respondToPrompt(prompt.runId, prompt.id, answer);
              await act(async () => {});
            }}
          />
        );
      })}
      {view.planning && !view.questions.length && (
        <LoadingState compact label="The planner is reading the code and drafting…" />
      )}
      <WorkspaceTabs.Root value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <WorkspaceTabs.List aria-label="Plan views">
          <WorkspaceTabs.Trigger value="plan">Plan</WorkspaceTabs.Trigger>
          <WorkspaceTabs.Trigger value="progress" disabled={!view.progress}>
            Progress
          </WorkspaceTabs.Trigger>
          <WorkspaceTabs.Trigger value="revisions">Revisions</WorkspaceTabs.Trigger>
        </WorkspaceTabs.List>
        <WorkspaceTabs.Content value="plan">
          <PlanReview view={view} act={act} />
        </WorkspaceTabs.Content>
        <WorkspaceTabs.Content value="progress">
          <PlanProgress view={view} act={act} />
        </WorkspaceTabs.Content>
        <WorkspaceTabs.Content value="revisions">
          <PlanRevisions view={view} />
        </WorkspaceTabs.Content>
      </WorkspaceTabs.Root>
    </section>
  );
}

function PlanReview({
  view,
  act,
}: {
  view: PlanView;
  act: (work: () => Promise<unknown>) => Promise<unknown>;
}) {
  const doc = view.document;
  const id = useId();
  const preferences = useProjectStore(
    (state) => state.projects.find((project) => project.id === view.projectId)?.preferences,
  );
  const verification = approvalVerification(view, preferences?.verifyCommand);
  const runners = useExecutionStore((state) => state.runners);
  const planner = useExecutionStore(
    (state) => state.runs.find((candidate) => candidate.id === view.plannerRunId)?.agent,
  );
  const customAgents = useAgentConfigStore((state) => state.customAgents);
  const reviewer = useMemo(
    () =>
      planReviewer(runners, { agent: view.agent, model: view.model }, planner, (agent) =>
        agentAdapter(agent, customAgents),
      ),
    [runners, view.agent, view.model, planner, customAgents],
  );
  const [shape, setShape] = useState<PlanShape>(view.shape);
  const [comments, setComments] = useState('');
  const [editing, setEditing] = useState(false);
  const [markdown, setMarkdown] = useState(view.markdown ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  useEffect(() => setShape(view.shape), [view.shape]);
  useEffect(() => {
    if (!editing) setMarkdown(view.markdown ?? '');
  }, [view.markdown, editing]);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    await act(work);
    setBusy(false);
  };
  const waves = useMemo(() => (doc ? taskWaves(doc.tasks) : []), [doc]);
  const coverage = useMemo(() => (doc ? criterionCoverage(doc) : []), [doc]);
  const assumed = useMemo(
    () => (doc ? doc.assumptions.filter((item) => !planAssumption(item).checked) : []),
    [doc],
  );
  if (!doc) return null;
  const reviewable = !view.planning && ['draft', 'approved'].includes(view.status);
  const running = view.status === 'running';
  return (
    <div className="plan-review">
      {reviewable && (
        <section className="plan-gate" aria-labelledby={`${id}-gate`}>
          <WorkspaceSectionHeading
            title="Approve and run"
            titleId={`${id}-gate`}
            description={
              doc.front.shapeReason
                ? `Recommended: ${doc.front.recommendedShape || 'single'} · ${doc.front.shapeReason}${
                    doc.front.workers ? ` · about ${doc.front.workers} workers` : ''
                  }`
                : undefined
            }
          />
          {assumed.length > 0 && (
            <InlineNotice tone="warning">
              <strong>Check these assumptions before approving.</strong>
              <Bullets items={assumed} empty="" />
            </InlineNotice>
          )}
          <fieldset className="plan-shapes">
            <legend className="sr-only">How to run the plan</legend>
            {shapeChoices(view).map((choice) => (
              <label
                key={choice.shape}
                className="plan-shape"
                data-selected={shape === choice.shape || undefined}
                data-disabled={choice.unavailable ? true : undefined}
              >
                <input
                  type="radio"
                  name={`${id}-shape`}
                  value={choice.shape}
                  checked={shape === choice.shape}
                  disabled={!!choice.unavailable || busy}
                  onChange={() => setShape(choice.shape)}
                />
                <span>
                  <strong>
                    {choice.label}
                    {choice.shape === 'swarm' && <BetaBadge />}
                  </strong>
                  <span className="plan-muted">{choice.unavailable ?? choice.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <ApprovalCheck projectId={view.projectId} verification={verification} disabled={busy} />
          <div className="plan-actions">
            <Button
              disabled={busy || !view.revision || !view.hash}
              loading={busy}
              loadingLabel="Starting…"
              onClick={() =>
                view.revision &&
                view.hash &&
                void run(() =>
                  planCommands.approve(
                    view.id,
                    view.revision ?? 0,
                    view.hash ?? '',
                    shape,
                    {
                      verifyCommand: preferences?.verifyCommand,
                      prepareCommand: preferences?.prepareCommand,
                      setupFiles: preferences?.setupFiles,
                    },
                    reviewer,
                  ),
                )
              }
            >
              Approve and run
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setEditing(!editing)}>
              {editing ? 'Close editor' : 'Edit directly'}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void run(async () => setSaved(await planCommands.export(view.id)))}
            >
              Save to repo
            </Button>
          </div>
          {saved && (
            <InlineNotice tone="success">Saved to {saved}. It is not committed.</InlineNotice>
          )}
        </section>
      )}
      {editing && (
        <section className="plan-editor" aria-labelledby={`${id}-editor`}>
          <WorkspaceSectionHeading
            title="Edit the plan"
            titleId={`${id}-editor`}
            description="Keep task headings as ### key · title, criteria as - AC-n [verify] text and checked facts as - Checked: fact — evidence: source."
          />
          <Textarea
            aria-labelledby={`${id}-editor`}
            className="plan-markdown"
            rows={18}
            value={markdown}
            onChange={(event) => setMarkdown(event.target.value)}
          />
          <div className="plan-actions">
            <Button
              disabled={busy || markdown === view.markdown}
              onClick={() =>
                void run(async () => {
                  await planCommands.save(view.id, markdown, view.revision ?? 0);
                  setEditing(false);
                })
              }
            >
              Save draft
            </Button>
          </div>
        </section>
      )}
      {(reviewable || running) && (
        <section className="plan-comments" aria-labelledby={`${id}-comments`}>
          <WorkspaceSectionHeading
            title={running ? 'Re-plan' : 'Keep planning'}
            titleId={`${id}-comments`}
            description={
              running
                ? 'Finished tasks are kept. The revised plan needs your approval; running tasks continue.'
                : 'Tell the planner what to change. It returns a new revision.'
            }
          />
          <Textarea
            aria-labelledby={`${id}-comments`}
            rows={3}
            maxLength={8000}
            value={comments}
            onChange={(event) => setComments(event.target.value)}
          />
          <div className="plan-actions">
            <Button
              variant="outline"
              disabled={busy || (!running && !comments.trim())}
              onClick={() =>
                void run(async () => {
                  await (running
                    ? planCommands.replan(view.id, comments)
                    : planCommands.keepPlanning(view.id, comments));
                  setComments('');
                })
              }
            >
              {running ? 'Re-plan' : 'Send to planner'}
            </Button>
          </div>
        </section>
      )}
      <PlanDocumentView view={view} waves={waves} coverage={coverage} />
    </div>
  );
}

function PlanDocumentView({
  view,
  waves,
  coverage,
}: {
  view: PlanView;
  waves: string[][];
  coverage: ReturnType<typeof criterionCoverage>;
}) {
  const doc = view.document;
  if (!doc) return null;
  const changed = new Set(view.changes.map((change) => change.section));
  const mark = (section: string) => (changed.has(section) ? 'changed' : undefined);
  return (
    <article className="plan-document">
      <section data-change={mark('Goal')}>
        <h3>Goal</h3>
        <p className="plan-prose">{doc.goal}</p>
      </section>
      <section data-change={mark('Context')}>
        <h3>Context</h3>
        <p className="plan-prose">{doc.context || 'None recorded.'}</p>
      </section>
      <section data-change={mark('Clarifications')}>
        <h3>Clarifications</h3>
        {doc.clarifications.length ? (
          <dl className="plan-clarifications">
            {doc.clarifications.map((item) => (
              <div key={item.question}>
                <dt>{item.question}</dt>
                <dd>{item.answer || 'Unanswered'}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="plan-muted">The code answered everything.</p>
        )}
      </section>
      <section data-change={mark('Assumptions')}>
        <h3>Assumptions</h3>
        <Assumptions items={doc.assumptions} />
      </section>
      <section data-change={mark('Out of scope')}>
        <h3>Out of scope</h3>
        <Bullets items={doc.outOfScope} empty="Nothing excluded." />
      </section>
      <section data-change={mark('Approach & Interfaces')}>
        <h3>Approach and interfaces</h3>
        <p className="plan-prose">{doc.approach}</p>
      </section>
      <section data-change={mark('Tasks')}>
        <h3>Tasks</h3>
        <ol className="plan-waves">
          {waves.map((wave, index) => (
            <li key={wave.join(',')}>
              <span className="plan-muted">Step {index + 1}</span>
              <div className="plan-wave">
                {wave.map((key) => {
                  const task = doc.tasks.find((item) => item.key === key);
                  if (!task) return null;
                  return (
                    <div key={key} className="plan-task">
                      <strong>
                        {task.title}
                        {task.status === 'done' && (
                          <Badge variant="success" className="ml-2">
                            Done
                          </Badge>
                        )}
                      </strong>
                      <span className="plan-muted">
                        {key}
                        {task.dependsOn.length ? ` · after ${task.dependsOn.join(', ')}` : ''}
                        {task.covers.length ? ` · covers ${task.covers.join(', ')}` : ''}
                      </span>
                      <span className="plan-scopes">{task.scopes.join(', ')}</span>
                      {task.briefing && <p className="plan-prose">{task.briefing}</p>}
                    </div>
                  );
                })}
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section data-change={mark('Acceptance criteria')}>
        <h3>Acceptance criteria</h3>
        <ul className="plan-criteria">
          {coverage.map((criterion) => (
            <li key={criterion.id}>
              <span className="plan-criterion-id">{criterion.id}</span>
              <span>
                {criterion.text}
                <span className="plan-muted">
                  {' '}
                  · {criterion.verify}
                  {criterion.check ? `: ${criterion.check}` : ''} ·{' '}
                  {criterion.tasks.length ? `by ${criterion.tasks.join(', ')}` : 'not covered'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section data-change={mark('Risks')}>
        <h3>Risks</h3>
        <Bullets items={doc.risks} empty="None recorded." />
      </section>
      <section data-change={mark('Decision log')}>
        <h3>Decision log</h3>
        <Bullets items={doc.decisionLog} empty="None recorded." />
      </section>
      <section data-change={mark('Surprises')}>
        <h3>Surprises</h3>
        <Bullets items={doc.surprises} empty="None recorded." />
      </section>
    </article>
  );
}

function PlanProgress({
  view,
  act,
}: {
  view: PlanView;
  act: (work: () => Promise<unknown>) => Promise<unknown>;
}) {
  const progress = view.progress;
  const runs = useExecutionStore((state) => state.runs);
  if (!progress) return null;
  const states = new Map(view.criteria.map((state) => [state.id, state]));
  const hostOf = (runId: string | null | undefined) => {
    const run = runId ? runs.find((candidate) => candidate.id === runId) : undefined;
    return run ? runHostName(run) : null;
  };
  return (
    <div className="plan-progress">
      {progress.error && <InlineNotice tone="warning">{progress.error}</InlineNotice>}
      <div className="plan-actions">
        <Button
          variant="outline"
          onClick={() => {
            selectWork({ plan: progress.managedTaskId });
            navigateWorkspace('kanban');
          }}
        >
          Open the work
        </Button>
        {!progress.dispatching && !progress.merged && (
          <span className="plan-muted">Paused · remaining tasks wait</span>
        )}
        {progress.repairs > 0 && (
          <span className="plan-muted">
            Repairs {progress.repairs} of {progress.repairLimit}
          </span>
        )}
      </div>
      {view.rounds && (
        <PlanRoundList
          planId={view.id}
          projectId={view.projectId}
          rounds={view.rounds}
          escalation={view.autonomy?.entries.find(
            (entry) =>
              entry.kind === 'round' &&
              entry.outcome === 'escalated' &&
              entry.subject === `Start round ${(view.rounds?.current ?? 0) + 1}`,
          )}
          act={act}
        />
      )}
      <WorkspaceSectionHeading
        title={view.rounds ? `Round ${view.rounds.current} tasks` : 'Tasks'}
        level={3}
      />
      <ul className="plan-rows">
        {[...progress.tasks, ...(progress.review ? [progress.review] : [])].map((task) => (
          <li key={`${task.key}:${task.runId ?? ''}`}>
            <span>
              {task.key === 'review' ? 'Independent review' : task.title}
              {hostOf(task.runId) && <span className="plan-muted"> · on {hostOf(task.runId)}</span>}
              {!!task.outside?.length && (
                <span className="plan-muted"> · outside scope: {task.outside.join(', ')}</span>
              )}
            </span>
            <StateBadge state={task.state} label={taskStateLabels[task.state] ?? task.state} />
          </li>
        ))}
      </ul>
      {progress.gaps.length > 0 && (
        <>
          <WorkspaceSectionHeading title="Review findings" level={3} />
          <ul className="plan-rows">
            {progress.gaps.map((gap) => (
              <li key={gap.text}>
                <span>{gap.text}</span>
                <Badge
                  variant={
                    gap.severity === 'critical'
                      ? 'danger'
                      : gap.severity === 'major'
                        ? 'warning'
                        : 'default'
                  }
                >
                  {gap.severity}
                </Badge>
              </li>
            ))}
          </ul>
        </>
      )}
      <WorkspaceSectionHeading
        title="Acceptance criteria"
        level={3}
        description="Agent claims and checks are evidence; your acceptance happens in review."
      />
      <ul className="plan-rows">
        {(view.document?.criteria ?? []).map((criterion) => {
          const state = states.get(criterion.id)?.state ?? 'unassessed';
          return (
            <li key={criterion.id}>
              <span>
                <span className="plan-criterion-id">{criterion.id}</span> {criterion.text}
              </span>
              <StateBadge state={state} label={criterionStateLabels[state]} />
            </li>
          );
        })}
      </ul>
      {view.deviations.some((deviation) => deviation.status !== 'pending') && (
        <>
          <WorkspaceSectionHeading title="Resolved deviations" level={3} />
          <ul className="plan-rows">
            {view.deviations
              .filter((deviation) => deviation.status !== 'pending')
              .map((deviation) => (
                <li key={deviation.id}>
                  <span>{deviation.summary}</span>
                  <Badge>{deviation.status}</Badge>
                </li>
              ))}
          </ul>
        </>
      )}
      {(view.rounds ? view.status === 'done' : progress.merged) && (
        <Button variant="ghost" onClick={() => void act(() => planCommands.archive(view.id))}>
          Archive plan
        </Button>
      )}
    </div>
  );
}

/** Each swarm round's verdict, evidence and the work it queued next. */
function PlanRoundList({
  planId,
  projectId,
  rounds,
  escalation,
  act,
}: {
  planId: string;
  projectId: string;
  rounds: PlanRounds;
  /** Why the proposed round came to the person although an agent could approve it. */
  escalation?: AutonomyEntry;
  act: (work: () => Promise<unknown>) => Promise<unknown>;
}) {
  const current = rounds.rounds.at(-1);
  const open = current && ['working', 'reviewing', 'held', 'approval'].includes(current.state);
  const orchestrators = rounds.orchestrators ?? 1;
  return (
    <section className="plan-rounds" aria-labelledby={`${planId}-rounds`}>
      <WorkspaceSectionHeading
        title={
          <span className="plan-swarm">
            Rounds <BetaBadge />
          </span>
        }
        titleId={`${planId}-rounds`}
        level={3}
        description={`Round ${rounds.current} of at most ${rounds.max}. After each merge ${
          orchestrators > 1
            ? `up to ${orchestrators} orchestrators check`
            : 'an orchestrator checks'
        } the criteria.`}
      />
      {open && <HostCapacity projectId={projectId} label="Where this round runs" />}
      {open && (
        <div className="plan-actions">
          <Select
            aria-label="Next rounds"
            value={rounds.askFirst ? 'ask' : 'auto'}
            onValueChange={(value) =>
              void act(() => planCommands.rounds(planId, value === 'ask' ? 'ask' : 'auto'))
            }
          >
            <SelectItem value="auto">Start next rounds automatically</SelectItem>
            <SelectItem value="ask">Ask me first</SelectItem>
          </Select>
          {current.state !== 'approval' && (
            <>
              {rounds.paused ? (
                <Button
                  variant="outline"
                  onClick={() => void act(() => planCommands.rounds(planId, 'resume'))}
                >
                  Resume rounds
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => void act(() => planCommands.rounds(planId, 'pause'))}
                >
                  Pause rounds
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => void act(() => planCommands.rounds(planId, 'stop'))}
              >
                Stop
              </Button>
            </>
          )}
        </div>
      )}
      {current?.held && <InlineNotice tone="warning">{current.held}</InlineNotice>}
      {current?.proposal && (
        <RoundProposal
          key={current.number}
          planId={planId}
          proposal={current.proposal}
          deciding={!!current.agentDeciding}
          escalation={escalation}
          act={act}
        />
      )}
      <ol className="plan-rows">
        {[...rounds.rounds].reverse().map((round) => (
          <li key={round.number} className="plan-round">
            <span>
              <strong>Round {round.number}</strong>
              {round.summary && <span className="plan-prose">{round.summary}</span>}
              {round.check && (
                <span className="plan-muted">
                  {round.check.passed ? 'Check passed' : 'Check failed'}: {round.check.command}
                </span>
              )}
              {round.evidence.length > 0 && <Bullets items={round.evidence} empty="" />}
              {round.next.length > 0 && !round.proposal && (
                <span className="plan-muted">Next: {round.next.join(' · ')}</span>
              )}
              {!!round.areas?.length && (
                <ul className="plan-round-areas" aria-label={`Round ${round.number} areas`}>
                  {round.areas.map((area) => (
                    <li key={area.name}>
                      <span>
                        {area.name}
                        {area.next.length > 0 && (
                          <span className="plan-muted"> · next: {area.next.join(' · ')}</span>
                        )}
                      </span>
                      <StateBadge state={area.state} label={areaStateLabels[area.state]} />
                    </li>
                  ))}
                </ul>
              )}
            </span>
            <StateBadge state={round.state} label={roundStateLabels[round.state]} />
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The orchestrator's proposed next round: nothing starts until it is approved. */
function RoundProposal({
  planId,
  proposal,
  deciding,
  escalation,
  act,
}: {
  planId: string;
  proposal: RoundAssignment[];
  /** An agent is deciding it for the person. */
  deciding: boolean;
  escalation?: AutonomyEntry;
  act: (work: () => Promise<unknown>) => Promise<unknown>;
}) {
  const id = useId();
  const [draft, setDraft] = useState<RoundAssignment[] | null>(null);
  const items = draft ?? proposal;
  const change = (index: number, edit: Partial<RoundAssignment>) =>
    setDraft(items.map((item, at) => (at === index ? { ...item, ...edit } : item)));
  const remove = (index: number) => {
    const removed = items[index].key;
    setDraft(
      items
        .filter((_, at) => at !== index)
        .map((item) => ({
          ...item,
          dependsOn: item.dependsOn.filter((key) => key !== removed),
        })),
    );
  };
  const approved = draft?.map((item) => ({
    ...item,
    scopes: item.scopes.map((scope) => scope.trim()).filter(Boolean),
  }));
  return (
    <section className="plan-round-proposal" aria-labelledby={`${id}-proposal`}>
      <WorkspaceSectionHeading
        title="Next round"
        titleId={`${id}-proposal`}
        level={3}
        description={
          deciding
            ? 'An agent is checking this round against the plan. You can still approve, edit or stop it.'
            : 'Nothing starts until you approve.'
        }
      />
      {!deciding && escalation?.reason && (
        <EscalationNote category={escalation.category ?? 'decider'} reason={escalation.reason} />
      )}
      <ol className="plan-rows">
        {items.map((item, index) =>
          draft ? (
            <li key={item.key} className="plan-round">
              <span className="plan-proposal-edit">
                <label htmlFor={`${id}-${index}-title`}>Title</label>
                <Input
                  id={`${id}-${index}-title`}
                  value={item.title}
                  maxLength={160}
                  onChange={(event) => change(index, { title: event.target.value })}
                />
                <label htmlFor={`${id}-${index}-prompt`}>Instructions</label>
                <Textarea
                  id={`${id}-${index}-prompt`}
                  rows={3}
                  maxLength={8000}
                  value={item.prompt}
                  onChange={(event) => change(index, { prompt: event.target.value })}
                />
                <label htmlFor={`${id}-${index}-scopes`}>Scopes</label>
                <Input
                  id={`${id}-${index}-scopes`}
                  value={item.scopes.join(', ')}
                  placeholder="src/feature"
                  onChange={(event) =>
                    change(index, {
                      scopes: event.target.value.split(',').map((scope) => scope.trimStart()),
                    })
                  }
                />
              </span>
              <Button
                variant="ghost"
                aria-label={`Remove ${item.title}`}
                onClick={() => remove(index)}
              >
                Remove
              </Button>
            </li>
          ) : (
            <li key={item.key} className="plan-round">
              <span>
                <strong>{item.title}</strong>
                <span className="plan-muted">
                  {item.scopes.join(', ')}
                  {item.dependsOn.length > 0 && ` · after ${item.dependsOn.join(', ')}`}
                </span>
              </span>
            </li>
          ),
        )}
      </ol>
      <div className="plan-actions">
        <Button
          disabled={approved?.length === 0}
          onClick={() => void act(() => planCommands.rounds(planId, 'approve', approved))}
        >
          {draft ? 'Approve edits' : 'Approve'}
        </Button>
        {draft ? (
          <Button variant="outline" onClick={() => setDraft(null)}>
            Discard edits
          </Button>
        ) : (
          <Button variant="outline" onClick={() => setDraft(proposal)}>
            Edit
          </Button>
        )}
        <Button variant="ghost" onClick={() => void act(() => planCommands.rounds(planId, 'stop'))}>
          Stop
        </Button>
      </div>
    </section>
  );
}

function PlanRevisions({ view }: { view: PlanView }) {
  const numbers = view.revisions.map((revision) => revision.number);
  const [from, setFrom] = useState(numbers.at(-2) ?? numbers[0] ?? 0);
  const [to, setTo] = useState(numbers.at(-1) ?? 0);
  const { data: changes, error } = useNativeResource<SectionChange[]>(
    async () => (!from || !to || from === to ? [] : planCommands.diff(view.id, from, to)),
    [view.id, from, to],
  );
  return (
    <div className="plan-revisions">
      <ul className="plan-rows">
        {[...view.revisions].reverse().map((revision) => (
          <li key={revision.number}>
            <span>
              Revision {revision.number} · {revision.note || revision.author}
            </span>
            <span className="plan-muted">{new Date(revision.createdAt).toLocaleString()}</span>
          </li>
        ))}
      </ul>
      {numbers.length > 1 && (
        <>
          <div className="plan-compare">
            <Select
              aria-label="Compare from revision"
              value={String(from)}
              onValueChange={(value) => setFrom(Number(value))}
            >
              {numbers.map((number) => (
                <SelectItem key={number} value={String(number)}>
                  Revision {number}
                </SelectItem>
              ))}
            </Select>
            <Select
              aria-label="Compare to revision"
              value={String(to)}
              onValueChange={(value) => setTo(Number(value))}
            >
              {numbers.map((number) => (
                <SelectItem key={number} value={String(number)}>
                  Revision {number}
                </SelectItem>
              ))}
            </Select>
          </div>
          <ActionError error={error} />
          {changes?.length === 0 && <p className="plan-muted">No section changed.</p>}
          {changes?.map((change) => (
            <section key={change.section} className="plan-diff">
              <h3>
                {change.section} <span className="plan-muted">· {change.change}</span>
              </h3>
              {change.before && <pre data-side="before">{change.before}</pre>}
              {change.after && <pre data-side="after">{change.after}</pre>}
            </section>
          ))}
        </>
      )}
    </div>
  );
}

const deviationKinds: Record<PlanView['deviations'][number]['kind'], string> = {
  declared: 'An agent reported a departure from the plan.',
  scope: 'A task changed files outside its scope.',
  criterion: 'The combined result still fails after the allowed repairs.',
};

/** How approval verifies the work, with a way to save a check when there is none. */
function ApprovalCheck({
  projectId,
  verification,
  disabled,
}: {
  projectId: string;
  verification: ReturnType<typeof approvalVerification>;
  disabled: boolean;
}) {
  const id = useId();
  const [command, setCommand] = useState('');
  if (verification.source === 'project')
    return (
      <p className="plan-muted">Each task and the combined result run {verification.command}.</p>
    );
  if (verification.source === 'criteria')
    return (
      <p className="plan-muted">
        No project check is saved, so the plan's test criteria are the check: {verification.command}
        .
      </p>
    );
  return (
    <InlineNotice tone="warning">
      <strong>No automatic check: results are reviewed but not test-verified.</strong>
      <p>
        An independent review and the agents' own assessments decide whether the work is done. Add a
        check command to test each task and the combined result.
      </p>
      <form
        className="plan-check-form"
        onSubmit={(event) => {
          event.preventDefault();
          const value = command.trim();
          if (!value) return;
          useProjectStore.getState().updateProjectPreferences(projectId, { verifyCommand: value });
          setCommand('');
        }}
      >
        <label className="sr-only" htmlFor={`${id}-check`}>
          Check command
        </label>
        <Input
          id={`${id}-check`}
          value={command}
          maxLength={4000}
          placeholder="pnpm test"
          disabled={disabled}
          onChange={(event) => setCommand(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={disabled || !command.trim()}>
          Add a check command
        </Button>
      </form>
    </InlineNotice>
  );
}
