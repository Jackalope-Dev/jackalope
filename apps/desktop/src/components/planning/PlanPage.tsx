import { Badge, Input, Textarea } from '@jackalope/ui';
import { ClipboardList } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  criterionCoverage,
  criterionStateLabels,
  interviewOptions,
  type PlanShape,
  type PlanSummary,
  type PlanView,
  planCommands,
  type SectionChange,
  shapeChoices,
  stateTone,
  statusLabels,
  taskStateLabels,
  taskWaves,
} from '../../lib/plan-mode';
import { respondToPrompt } from '../../lib/task-runtime';
import { selectWork } from '../../lib/work-selection';
import { useExecutionStore } from '../../stores/executionStore';
import { usePlanStore } from '../../stores/planStore';
import { useProjectStore } from '../../stores/projectStore';
import { navigateWorkspace } from '../layout/navigation';
import { AgentQuestion } from '../tasks/AgentQuestion';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { InlineNotice } from '../ui/InlineNotice';
import { LoadingState } from '../ui/LoadingState';
import { Select, SelectItem } from '../ui/Select';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import { WorkspaceTabs } from '../ui/WorkspaceTabs';
import './plan-page.css';

type Tab = 'plan' | 'progress' | 'revisions' | 'settings';
const toneVariant = {
  success: 'success',
  danger: 'danger',
  accent: 'accent',
  muted: 'default',
} as const;

function StateBadge({ state, label }: { state: string; label: string }) {
  return <Badge variant={toneVariant[stateTone(state)]}>{label}</Badge>;
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

export function PlanPage() {
  const { activeProjectId, projects } = useProjectStore(
    useShallow((state) => ({ activeProjectId: state.activeProjectId, projects: state.projects })),
  );
  const project = projects.find((item) => item.id === activeProjectId);
  const { selectedId, select } = usePlanStore();
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [view, setView] = useState<PlanView | null>(null);
  const [error, setError] = useState('');
  const runs = useExecutionStore((state) => state.runs);

  const loadList = useCallback(async () => {
    if (!project) return;
    try {
      const result = await planCommands.list(project.id);
      setPlans(result.plans);
      setProblems(result.problems);
    } catch (cause) {
      setError(String(cause));
      setPlans([]);
    }
  }, [project]);
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
      setError(String(cause));
    } finally {
      loading.current = false;
    }
  }, [current]);
  // Planning and delivery move with task attempts, so re-read when runs change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs is the change signal
  useEffect(() => {
    void load();
  }, [load, runs]);

  const act = async (work: () => Promise<unknown>) => {
    setError('');
    try {
      await work();
      await Promise.all([load(), loadList()]);
    } catch (cause) {
      setError(String(cause));
    }
  };

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
        description="Explore read-only, answer a few questions, then approve a plan before code changes."
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
          description="Write a request in the composer and choose Plan first."
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
                  {statusLabels[plan.status] ?? plan.status}
                  {plan.revision ? ` · r${plan.revision}` : ''}
                </span>
              </button>
            ))}
          </nav>
          <div className="plan-detail">
            {error && <InlineNotice tone="error">{error}</InlineNotice>}
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
  act: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>(view.progress ? 'progress' : 'plan');
  const pending = view.deviations.filter((deviation) => deviation.status === 'pending');
  return (
    <section className="plan-detail-body" aria-labelledby="plan-title">
      <header className="plan-detail-header">
        <div>
          <h2 id="plan-title">{view.document?.title ?? view.title}</h2>
          <p className="plan-muted">
            {statusLabels[view.status]}
            {view.revision ? ` · revision ${view.revision}` : ''}
            {view.approval ? ` · approved by ${view.approval.approvedBy}` : ''}
          </p>
        </div>
      </header>
      {view.error && <InlineNotice tone="warning">{view.error}</InlineNotice>}
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
          <strong>The work departed from the plan.</strong> {deviation.summary}
          {deviation.amendment && <p>Proposed amendment: {deviation.amendment}</p>}
          <p>Dependent tasks are paused until you decide.</p>
        </InlineNotice>
      ))}
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
          <WorkspaceTabs.Trigger value="settings">Settings</WorkspaceTabs.Trigger>
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
        <WorkspaceTabs.Content value="settings">
          <PlanSettingsForm view={view} act={act} />
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
  act: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const doc = view.document;
  const id = useId();
  const preferences = useProjectStore(
    (state) => state.projects.find((project) => project.id === view.projectId)?.preferences,
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
          {doc.assumptions.length > 0 && (
            <InlineNotice tone="warning">
              <strong>Check these assumptions before approving.</strong>
              <Bullets items={doc.assumptions} empty="" />
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
                  <strong>{choice.label}</strong>
                  <span className="plan-muted">{choice.unavailable ?? choice.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="plan-actions">
            <Button
              disabled={busy || !view.revision || !view.hash}
              loading={busy}
              loadingLabel="Starting…"
              onClick={() =>
                view.revision &&
                view.hash &&
                void run(() =>
                  planCommands.approve(view.id, view.revision ?? 0, view.hash ?? '', shape, {
                    verifyCommand: preferences?.verifyCommand,
                    prepareCommand: preferences?.prepareCommand,
                    setupFiles: preferences?.setupFiles,
                  }),
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
            description="Keep task headings as ### key · title and criteria as - AC-n [verify] text."
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
  act: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const progress = view.progress;
  if (!progress) return null;
  const states = new Map(view.criteria.map((state) => [state.id, state]));
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
      <WorkspaceSectionHeading title="Tasks" level={3} />
      <ul className="plan-rows">
        {[...progress.tasks, ...(progress.review ? [progress.review] : [])].map((task) => (
          <li key={`${task.key}:${task.runId ?? ''}`}>
            <span>
              {task.key === 'review' ? 'Independent review' : task.title}
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
      {progress.merged && (
        <Button variant="ghost" onClick={() => void act(() => planCommands.archive(view.id))}>
          Archive plan
        </Button>
      )}
    </div>
  );
}

function PlanRevisions({ view }: { view: PlanView }) {
  const numbers = view.revisions.map((revision) => revision.number);
  const [from, setFrom] = useState(numbers.at(-2) ?? numbers[0] ?? 0);
  const [to, setTo] = useState(numbers.at(-1) ?? 0);
  const [changes, setChanges] = useState<SectionChange[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!from || !to || from === to) {
      setChanges([]);
      return;
    }
    let alive = true;
    planCommands
      .diff(view.id, from, to)
      .then((value) => alive && setChanges(value))
      .catch((cause) => alive && setError(String(cause)));
    return () => {
      alive = false;
    };
  }, [view.id, from, to]);
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
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
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

function PlanSettingsForm({
  view,
  act,
}: {
  view: PlanView;
  act: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const id = useId();
  const runners = useExecutionStore((state) => state.runners);
  const [cap, setCap] = useState(String(view.settings.questionCap));
  const [agent, setAgent] = useState(view.settings.plannerAgent ?? '');
  const [path, setPath] = useState(view.settings.exportPath);
  const [saved, setSaved] = useState(false);
  const capValue = Number(cap);
  const valid = Number.isInteger(capValue) && capValue >= 0 && capValue <= 12 && !!path.trim();
  return (
    <form
      className="plan-settings"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        setSaved(false);
        void act(async () => {
          await planCommands.saveSettings(view.projectId, {
            questionCap: capValue,
            plannerAgent: agent || null,
            plannerModel: null,
            exportPath: path.trim(),
          });
          setSaved(true);
        });
      }}
    >
      <p className="plan-muted">These apply to new plans in this project.</p>
      <label className="task-label" htmlFor={`${id}-cap`}>
        Most questions per plan
      </label>
      <Input
        id={`${id}-cap`}
        type="number"
        min={0}
        max={12}
        value={cap}
        onChange={(event) => setCap(event.target.value)}
      />
      <label className="task-label" htmlFor={`${id}-agent`}>
        Planning agent
      </label>
      <Select
        id={`${id}-agent`}
        aria-label="Planning agent"
        value={agent || 'task'}
        onValueChange={(value) => setAgent(value === 'task' ? '' : value)}
      >
        <SelectItem value="task">The task's agent</SelectItem>
        {runners
          .filter((runner) => runner.available)
          .map((runner) => (
            <SelectItem key={runner.id} value={runner.id}>
              {runner.name}
            </SelectItem>
          ))}
      </Select>
      <label className="task-label" htmlFor={`${id}-path`}>
        Save to repo path
      </label>
      <Input
        id={`${id}-path`}
        value={path}
        maxLength={240}
        onChange={(event) => setPath(event.target.value)}
      />
      <p className="plan-muted">{'{slug}'} becomes the plan title. Files are never committed.</p>
      <div className="plan-actions">
        <Button type="submit" disabled={!valid}>
          Save settings
        </Button>
        {saved && <span role="status">Saved</span>}
      </div>
    </form>
  );
}
