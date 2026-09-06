import { Bot, CircleCheck, FolderOpen, Plus, Workflow } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { planningDraft } from '../../lib/planning';
import { detectSkillsFromPrompt, VETTED_SKILLS } from '../../lib/skills/catalog.ts';
import { assemblePrompt } from '../../lib/skills/context-assembler.ts';
import { collectWork } from '../../lib/task-collection';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { emptyDraft, useExecutionStore } from '../../stores/executionStore';
import { useMcpStore } from '../../stores/mcpStore';
import {
  agentAccountFor,
  isAgentAllowedForProject,
  useProjectStore,
} from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { CodebaseMemoryBar } from './CodebaseMemoryBar';
import { ProjectQueue } from './ProjectQueue';
import { ProjectSetup } from './ProjectSetup';
import { TaskCollection, type TaskCollectionView } from './TaskCollection';
import { TaskComposer } from './TaskComposer';
import { TaskDetail } from './TaskDetail';
import { TaskModal } from './TaskModal';

export function TaskWorkspace({
  newTaskAgent,
  onNewTaskHandled,
}: {
  newTaskAgent?: string | null;
  onNewTaskHandled?: () => void;
}) {
  const { projects, activeProjectId } = useProjectStore();
  const {
    runs,
    runners,
    selectedId,
    select,
    drafts,
    draft,
    start,
    submitting,
    loading,
    error,
    discover,
    discovering,
  } = useExecutionStore();
  const project = projects.find((p) => p.id === activeProjectId);
  const [plannedTaskId, setPlannedTaskId] = useState<string | null>(null);
  const [editingIdea, setEditingIdea] = useState<string | null>(null);
  const ideas = useTaskStore((state) => state.tasks);
  const plannedTask = useTaskStore((state) =>
    state.tasks.find((task) => task.id === plannedTaskId && task.projectId === activeProjectId),
  );
  const [setup, setSetup] = useState(!!newTaskAgent && !project);
  const [submitError, setSubmitError] = useState('');
  const [parallel, setParallel] = useState(false);
  const [collectionView, setCollectionView] = useState<TaskCollectionView>({
    filter: 'all',
    layout: 'list',
    query: '',
  });
  const [composing, setComposing] = useState(!!newTaskAgent || !!plannedTask);
  useEffect(() => {
    if (newTaskAgent && project) {
      setComposing(true);
      setParallel(false);
      setPlannedTaskId(null);
      draft(project.id, { agent: newTaskAgent });
      onNewTaskHandled?.();
    }
  }, [newTaskAgent, project, draft, onNewTaskHandled]);

  useEffect(() => {
    if (composing) document.getElementById('task-intent')?.focus();
  }, [composing]);
  const key = plannedTask ? `planning:${plannedTask.id}` : (project?.id ?? 'projectless');
  const current = drafts[key] ?? emptyDraft;
  const selected = runs.find((run) => run.id === selectedId && run.projectId === project?.id);
  const items = project ? collectWork(project.id, ideas, runs) : [];
  const hasWork = items.length > 0;
  const agentConfig = useAgentConfigStore();
  const appDefaultRunner = agentConfig.defaultMetaAgent;
  const allowedRunners = runners.filter(
    (r) => agentConfig.isAgentEnabled(r.id) && isAgentAllowedForProject(project, r.id),
  );
  const allowedRunnerIds = new Set(allowedRunners.map((r) => r.id));
  const preferredAgent =
    project?.preferences?.preferredRunner &&
    project.preferences.preferredRunner !== 'inherit' &&
    allowedRunnerIds.has(project.preferences.preferredRunner)
      ? project.preferences.preferredRunner
      : (allowedRunners.find((r) => r.id === appDefaultRunner)?.id ?? allowedRunners[0]?.id ?? '');

  const requestedAgent = newTaskAgent || current.agent;
  const currentAgent =
    requestedAgent && allowedRunnerIds.has(requestedAgent) ? requestedAgent : preferredAgent;
  const runner = runners.find((r) => r.id === currentAgent);
  const desktop = isTauriEnvironment();

  const projectConnections = useMcpStore((s) => s.servers).filter(
    (s) => s.scope === `project:${project?.id}` && s.enabled !== false,
  );
  useEffect(() => {
    if (project?.id) void useMcpStore.getState().loadServers(project.id);
  }, [project?.id]);
  const detectedSkills = useMemo(() => detectSkillsFromPrompt(current.prompt), [current.prompt]);
  const activeSkills = current.skills ?? [];
  const assembled = useMemo(() => {
    return assemblePrompt({
      rawPrompt: current.prompt.trim(),
      selectedSkillIds: activeSkills,
      executionMode: current.isolated ? 'isolated' : 'current',
    });
  }, [current.prompt, activeSkills, current.isolated]);
  const projectInstructions = project?.preferences?.customInstructions?.trim();
  const promptWithGuidelines = assembled.hasSupplementation
    ? assembled.assembledPrompt
    : current.prompt.trim();
  const finalPrompt = projectInstructions
    ? `${promptWithGuidelines}\n\n[Project Guidelines]:\n${projectInstructions}`
    : promptWithGuidelines;

  const toggleSkill = (skillId: string) => {
    const next = activeSkills.includes(skillId)
      ? activeSkills.filter((id) => id !== skillId)
      : [...activeSkills, skillId];
    draft(key, { skills: next });
  };

  const launch = async () => {
    if (!project || !current.prompt.trim()) return;
    setSubmitError('');
    try {
      const currentAdapter =
        agentConfig.customAgents.find((a) => a.id === currentAgent)?.adapter ?? currentAgent;
      const runId = await start({
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        targetBranch: project.preferences?.baseBranch || project.gitBranch,
        verifyCommand: project.preferences?.verifyCommand,
        agent: currentAgent,
        agentProfileId: agentAccountFor(project, currentAdapter),
        prompt: finalPrompt,
        connectionIds: current.connectionIds,
        isolated: current.isolated,
      });
      draft(key, { prompt: '', skills: [] });
      if (plannedTask) useTaskStore.getState().updateTask(plannedTask.id, { runId });
      setPlannedTaskId(null);
      setComposing(false);
      setCollectionView((view) => ({ ...view, filter: 'all', query: '' }));
    } catch (error) {
      setSubmitError(String(error));
    }
  };
  const prepareIdea = (id: string) => {
    const idea = useTaskStore
      .getState()
      .tasks.find((item) => item.id === id && item.projectId === project?.id);
    if (!idea || idea.runId) return;
    const draftKey = `planning:${id}`;
    if (!useExecutionStore.getState().drafts[draftKey]?.prompt)
      draft(draftKey, planningDraft(idea));
    setPlannedTaskId(id);
    setComposing(true);
    setSubmitError('');
  };
  const saveForLater = () => {
    if (!project || !current.prompt.trim()) return;
    const value = {
      rawPrompt: current.prompt.trim(),
      refinedPrompt: assembled.hasSupplementation ? assembled.assembledPrompt : undefined,
      assignedAgent: currentAgent || undefined,
      clarifications: [
        {
          question: 'Active Skill Guidelines',
          answer: VETTED_SKILLS.filter((skill) => activeSkills.includes(skill.id))
            .map((skill) => skill.name)
            .join(', '),
        },
        {
          question: 'Git Execution Mode',
          answer: current.isolated ? 'Isolated worktree' : 'Active working checkout',
        },
      ],
    };
    if (plannedTask) useTaskStore.getState().updateTask(plannedTask.id, value);
    else
      useTaskStore.getState().addTask({
        ...value,
        projectId: project.id,
        title: current.prompt.trim().split('\n')[0].slice(0, 160),
        status: 'backlog',
      });
    draft(key, { prompt: '', skills: [] });
    setPlannedTaskId(null);
    setComposing(false);
    setSubmitError('');
    setCollectionView((view) => ({ ...view, filter: 'ideas', query: '' }));
  };
  if (selected) return <TaskDetail key={selected.id} run={selected} onBack={() => select(null)} />;
  if (parallel && project)
    return <ProjectQueue key={project.id} project={project} onBack={() => setParallel(false)} />;
  return (
    <section className="task-page task-home">
      <div className="task-introduction workspace-section-heading">
        <div>
          <h1 className="task-hero-title">
            {project ? (hasWork ? 'Tasks' : 'What’s next?') : 'A place to get things done.'}
          </h1>
          <p className="task-muted mt-3">
            {project
              ? hasWork
                ? 'From the first idea to the final review.'
                : 'Capture an idea or give an agent a clear next step.'
              : 'Your projects and agents, in one place.'}
          </p>
        </div>
        {project && (
          <div className="workspace-actions">
            <Button variant="outline" onClick={() => setParallel(true)}>
              <Workflow size={18} />
              Parallel work
            </Button>
            {hasWork && (
              <Button
                aria-expanded={composing}
                aria-controls="task-composer"
                onClick={() => {
                  setComposing(!composing);
                  setPlannedTaskId(null);
                  setSubmitError('');
                }}
              >
                <Plus size={18} />
                {composing ? 'Close composer' : 'New task'}
              </Button>
            )}
          </div>
        )}
      </div>
      {project && (composing || !hasWork) && (
        <CodebaseMemoryBar key={project.id} project={project} />
      )}
      {plannedTask && (
        <div className="task-notice flex flex-wrap items-center justify-between gap-3">
          <span>Preparing “{plannedTask.title}”</span>
          <Button
            variant="ghost"
            onClick={() => {
              setPlannedTaskId(null);
              setComposing(false);
            }}
          >
            Back to tasks
          </Button>
        </div>
      )}
      {!project ? (
        <div>
          <EmptyState
            icon={FolderOpen}
            title="Start with a project"
            description="Choose the repository you want to work on."
            action={
              <Button onClick={() => setSetup(true)}>
                <FolderOpen size={18} />
                Open project
              </Button>
            }
          />
          <ol className="journey-strip" aria-label="How tasks work">
            <li>
              <FolderOpen size={20} aria-hidden="true" />
              Project
            </li>
            <li>
              <Bot size={20} aria-hidden="true" />
              Agent
            </li>
            <li>
              <CircleCheck size={20} aria-hidden="true" />
              Review
            </li>
          </ol>
        </div>
      ) : (
        (!hasWork || composing) && (
          <TaskComposer
            current={current}
            currentAgent={currentAgent}
            runner={runner}
            allowedRunners={allowedRunners}
            submitting={submitting}
            desktop={desktop}
            activeSkills={activeSkills}
            suggestedSkills={detectedSkills.map((skill) => skill.id)}
            projectInstructions={projectInstructions}
            finalPrompt={finalPrompt}
            projectConnections={projectConnections}
            editingIdea={!!plannedTask}
            toggleSkill={toggleSkill}
            onChange={(value) => draft(key, value)}
            onLaunch={launch}
            onSave={saveForLater}
          />
        )
      )}
      {!desktop && (
        <p className="task-notice mt-5">
          Browser preview · connect projects and run agents in the desktop app.
        </p>
      )}
      {desktop && project && !runner?.available && (
        <div className="task-notice mt-5">
          <span>
            {discovering
              ? 'Checking your installed agents…'
              : (runner?.detail ?? 'Refresh to discover installed agents.')}
          </span>
          <button
            type="button"
            className="task-link"
            disabled={discovering}
            onClick={() => void discover()}
          >
            Refresh agents
          </button>
        </div>
      )}
      {(submitError || error) && (
        <p role="alert" className="task-error mt-5">
          {submitError || error}
        </p>
      )}
      {project && allowedRunners.length === 0 && (
        <p role="alert" className="task-error mt-5">
          No agents are allowed for {project.name}. Choose at least one in Settings → Project →
          Agents available here.
        </p>
      )}
      {project && (
        <>
          {loading && (
            <p role="status" className="task-muted mt-5">
              Loading task history…
            </p>
          )}
          <TaskCollection
            view={collectionView}
            onViewChange={setCollectionView}
            items={items}
            runners={runners}
            onOpen={(item) => {
              if (item.run) select(item.run.id);
              else if (item.idea) setEditingIdea(item.idea.id);
            }}
          />
        </>
      )}
      {editingIdea && (
        <TaskModal
          key={editingIdea}
          taskId={editingIdea}
          isOpen
          onClose={() => setEditingIdea(null)}
          onPrepare={prepareIdea}
        />
      )}
      <ProjectSetup
        open={setup}
        onClose={() => {
          setSetup(false);
          if (!useProjectStore.getState().activeProjectId) onNewTaskHandled?.();
        }}
      />
    </section>
  );
}
