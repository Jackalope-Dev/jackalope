import * as Dialog from '@radix-ui/react-dialog';
import { FolderOpen, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { planningDraft } from '../../lib/planning';
import { detectSkillsFromPrompt, VETTED_SKILLS } from '../../lib/skills/catalog';
import { assemblePrompt } from '../../lib/skills/context-assembler';
import { ideaStageLabels } from '../../lib/task-collection';
import { isTauriEnvironment, listMcpServers, type McpServerConfig } from '../../lib/tauri-bridge';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { emptyDraft, useExecutionStore } from '../../stores/executionStore';
import {
  agentAccountFor,
  isAgentAllowedForProject,
  useProjectStore,
} from '../../stores/projectStore';
import { type TaskStatus, useTaskStore } from '../../stores/taskStore';
import { Button } from '../ui/button';
import { ConfirmAction } from '../ui/ConfirmAction';
import { Select, SelectItem } from '../ui/Select';
import { useDialogFocus } from '../ui/useDialogFocus';
import { ProjectSetup } from './ProjectSetup';
import { TaskComposer } from './TaskComposer';

// The tools panel pulls in the agent, connection and project editors; load it
// only when the user opens it.
const TaskTools = lazy(() => import('./TaskTools').then((m) => ({ default: m.TaskTools })));

export function CaptureTask({
  ideaId,
  agent,
  draftKey,
  onClose,
  onStarted,
}: {
  ideaId?: string;
  agent?: string;
  draftKey?: string;
  onClose: () => void;
  onStarted: () => void;
}) {
  const focus = useDialogFocus();
  const { projects, activeProjectId, selectProject } = useProjectStore();
  const { drafts, draft, runners, start, submitting, discover, discovering } = useExecutionStore();
  const idea = useTaskStore((state) => state.tasks.find((task) => task.id === ideaId));
  const [key] = useState(() =>
    ideaId
      ? `planning:${ideaId}`
      : (draftKey ??
        (!drafts.capture && activeProjectId && drafts[activeProjectId]?.prompt
          ? activeProjectId
          : 'capture')),
  );
  const current = useMemo(() => {
    const initial = idea ? planningDraft(idea) : emptyDraft;
    return {
      title: idea?.title,
      planningStatus: idea?.status,
      ...initial,
      ...drafts[key],
      isolated:
        drafts[key]?.isolated ??
        (idea
          ? initial.isolated
          : (projects.find((p) => p.id === activeProjectId)?.preferences?.isolatedByDefault ??
            true)),
      projectId: drafts[key]?.projectId ?? idea?.projectId ?? activeProjectId ?? '',
      agent: drafts[key]?.agent || agent || initial.agent,
    };
  }, [idea, projects, activeProjectId, drafts, key, agent]);
  const project = projects.find((p) => p.id === current.projectId);
  const config = useAgentConfigStore();
  const allowed = runners.filter(
    (r) => config.isAgentEnabled(r.id) && isAgentAllowedForProject(project, r.id),
  );
  const preferred = project?.preferences?.preferredRunner;
  const defaultAgent =
    allowed.find((r) => r.id === preferred)?.id ??
    allowed.find((r) => r.id === config.defaultMetaAgent)?.id ??
    allowed.find((r) => r.available)?.id ??
    allowed[0]?.id ??
    '';
  const currentAgent = current.agent || defaultAgent;
  const runner = allowed.find((r) => r.id === currentAgent);
  const [error, setError] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolRevision, setToolRevision] = useState(0);
  const [setup, setSetup] = useState(false);
  const [setupProject, setSetupProject] = useState<string | null>(null);
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const connections = servers.filter(
    (s) => s.enabled !== false && s.scope === `project:${project?.id}`,
  );
  const [loadedProject, setLoadedProject] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const desktop = isTauriEnvironment();
  useEffect(() => {
    // Freeze the suggested destination with the draft; navigation must not retarget it.
    if (useExecutionStore.getState().drafts[key]?.projectId === undefined) draft(key, current);
  }, [key, current, draft]);
  useEffect(() => {
    if (!project || !desktop) return;
    let alive = true;
    setConnectionError('');
    void listMcpServers(project.id)
      .then((values) => {
        if (alive) {
          setServers(values);
          setLoadedProject(`${project.id}:${toolRevision}`);
        }
      })
      .catch((cause) => {
        if (alive) setConnectionError(String(cause));
      });
    return () => {
      alive = false;
    };
  }, [project, desktop, toolRevision]);
  useEffect(() => {
    if (agent) draft(key, { agent });
  }, [agent, key, draft]);
  const update = (value: Partial<typeof current>) => draft(key, { ...current, ...value });
  const skills = current.skills ?? [];
  const assembled = assemblePrompt({
    rawPrompt: current.prompt.trim(),
    selectedSkillIds: skills,
    executionMode: current.isolated ? 'isolated' : 'current',
  });
  const instructions = project?.preferences?.customInstructions?.trim();
  const finalPrompt = [
    assembled.assembledPrompt || current.prompt.trim(),
    instructions ? `[Project Guidelines]:\n${instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const saveIdea = (runId?: string) => {
    const value = {
      projectId: project?.id ?? current.projectId ?? '',
      title: current.title?.trim() || current.prompt.trim().split('\n')[0].slice(0, 160),
      status: current.planningStatus ?? 'backlog',
      rawPrompt: current.prompt.trim(),
      refinedPrompt: assembled.hasSupplementation ? assembled.assembledPrompt : undefined,
      assignedAgent: currentAgent || undefined,
      connectionIds: current.connectionIds,
      contextSelection: current.contextSelection,
      clarifications: [
        ...(idea?.clarifications?.filter(
          (item) => !['Active Skill Guidelines', 'Git Execution Mode'].includes(item.question),
        ) ?? []),
        {
          question: 'Active Skill Guidelines',
          answer: VETTED_SKILLS.filter((s) => skills.includes(s.id))
            .map((s) => s.name)
            .join(', '),
        },
        {
          question: 'Git Execution Mode',
          answer: current.isolated ? 'Isolated worktree' : 'Active working checkout',
        },
      ],
      ...(runId ? { runId } : {}),
    };
    if (idea) useTaskStore.getState().updateTask(idea.id, value);
    else useTaskStore.getState().addTask(value);
  };
  const clear = () => {
    useExecutionStore.setState((state) => {
      const next = { ...state.drafts };
      delete next[key];
      return { drafts: next };
    });
  };
  const launch = async () => {
    if (
      !project ||
      !runner?.available ||
      submitting ||
      !desktop ||
      loadedProject !== `${project.id}:${toolRevision}` ||
      connectionError ||
      !current.prompt.trim()
    )
      return;
    setError('');
    try {
      const adapter =
        config.customAgents.find((a) => a.id === currentAgent)?.adapter ?? currentAgent;
      const id = await start({
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        agent: currentAgent,
        agentProfileId: agentAccountFor(project, adapter),
        targetBranch: project.preferences?.baseBranch || project.gitBranch,
        verifyCommand: project.preferences?.verifyCommand,
        prepareCommand: project.preferences?.prepareCommand,
        autoVerify: project.preferences?.autoVerify === true,
        prompt: finalPrompt,
        isolated: current.isolated,
        connectionIds: current.connectionIds,
        contextSelection: current.contextSelection,
      });
      saveIdea(id);
      clear();
      selectProject(project.id);
      onStarted();
    } catch (cause) {
      setError(String(cause));
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content
          {...focus}
          onOpenAutoFocus={(event) => {
            focus.onOpenAutoFocus();
            event.preventDefault();
            document.getElementById('task-intent')?.focus();
          }}
          className="task-dialog appearance-panel capture-dialog"
          onEscapeKeyDown={(e) => {
            if (submitting) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (submitting) e.preventDefault();
          }}
        >
          <Dialog.Close className="task-close" aria-label="Close capture" disabled={submitting}>
            <X size={18} />
          </Dialog.Close>
          <Dialog.Title className="text-2xl pr-10">
            {idea ? idea.title : 'What do you want to accomplish?'}
          </Dialog.Title>
          <Dialog.Description className="task-muted mt-2 mb-5">
            Describe the outcome. Your draft stays here when you close this window.
          </Dialog.Description>
          <TaskComposer
            projectId={project?.id ?? ''}
            projectPath={project?.path ?? ''}
            executionReady={!!project}
            context={
              <>
                <div className="capture-destination">
                  <label className="task-label" htmlFor="capture-project">
                    Project
                  </label>
                  <Select
                    id="capture-project"
                    aria-label="Task project"
                    disabled={submitting}
                    value={current.projectId || 'unassigned'}
                    onValueChange={(id) =>
                      update({
                        projectId: id === 'unassigned' ? '' : id,
                        connectionIds: undefined,
                        contextSelection: undefined,
                      })
                    }
                  >
                    <SelectItem value="unassigned">Choose later · save an idea</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </Select>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSetupProject(activeProjectId);
                      setSetup(true);
                    }}
                  >
                    <FolderOpen size={16} />
                    Open project
                  </Button>
                </div>
                <p className="task-muted mb-4">
                  {project
                    ? `${project.name} · This computer · ${project.preferences?.agentAccounts?.[config.customAgents.find((a) => a.id === currentAgent)?.adapter ?? currentAgent] ? 'Saved project account' : 'Agent’s current account'}`
                    : current.projectId
                      ? 'The saved project is unavailable. Choose a destination or keep this as an idea.'
                      : 'No project required to save. Choose one before starting work.'}
                </p>
                {project?.preferences?.autoVerify && project.preferences.verifyCommand && (
                  <p className="task-muted mb-4">
                    Project checks will run automatically before review.
                  </p>
                )}
              </>
            }
            current={{ ...current, agent: currentAgent }}
            currentAgent={currentAgent}
            runner={runner}
            allowedRunners={allowed}
            submitting={submitting}
            desktop={
              desktop &&
              !!project &&
              loadedProject === `${project.id}:${toolRevision}` &&
              !connectionError
            }
            activeSkills={skills}
            suggestedSkills={detectSkillsFromPrompt(current.prompt).map((s) => s.id)}
            projectInstructions={instructions}
            finalPrompt={finalPrompt}
            projectConnections={connections}
            editingIdea={!!idea}
            toggleSkill={(id) =>
              update({
                skills: skills.includes(id) ? skills.filter((s) => s !== id) : [...skills, id],
              })
            }
            onChange={update}
            onLaunch={launch}
            onSave={() => {
              saveIdea();
              clear();
              onClose();
            }}
          />
          <Button
            variant="ghost"
            className="mt-3"
            onClick={() => {
              if (project) selectProject(project.id);
              setToolsOpen(true);
            }}
          >
            Set up agents, connections & checks
          </Button>
          {idea && (
            <details className="mt-4">
              <summary>Idea details</summary>
              <label className="task-label mt-4" htmlFor="capture-title">
                Title
              </label>
              <input
                id="capture-title"
                className="task-input w-full"
                value={current.title ?? ''}
                maxLength={160}
                onChange={(event) => update({ title: event.target.value })}
              />
              <label className="task-label mt-4" htmlFor="capture-stage">
                Planning stage
              </label>
              <Select
                id="capture-stage"
                aria-label="Planning stage"
                value={current.planningStatus ?? 'backlog'}
                onValueChange={(status) => update({ planningStatus: status as TaskStatus })}
              >
                {Object.entries(ideaStageLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </Select>
              <ConfirmAction
                title="Delete this idea?"
                description="The planning record will be removed. Agent tasks and worktrees are kept."
                onConfirm={() => {
                  useTaskStore.getState().deleteTask(idea.id);
                  clear();
                  onClose();
                }}
                trigger={
                  <Button variant="ghost" className="mt-4" disabled={submitting}>
                    Delete idea
                  </Button>
                }
              />
            </details>
          )}
          {toolsOpen && (
            <Suspense fallback={null}>
              <TaskTools
                onClose={() => {
                  setToolsOpen(false);
                  setLoadedProject(null);
                  setToolRevision((n) => n + 1);
                  if (desktop) void discover();
                }}
              />
            </Suspense>
          )}
          {project && !runner?.available && (
            <div className="task-notice mt-4">
              <span>
                {runner?.detail || 'Connect an agent to start. You can save this idea now.'}
              </span>
              <Button
                variant="ghost"
                disabled={!desktop || discovering}
                onClick={() => void discover()}
              >
                {discovering ? 'Checking…' : 'Refresh agents'}
              </Button>
            </div>
          )}
          {connectionError && (
            <Button variant="ghost" onClick={() => setToolRevision((n) => n + 1)}>
              Retry loading connections
            </Button>
          )}
          {(error || connectionError) && (
            <p role="alert" className="task-error mt-4">
              {error || connectionError}
            </p>
          )}
          {!desktop && (
            <p className="task-muted mt-3">
              Browser preview · ideas are saved locally; execution requires the desktop app.
            </p>
          )}
          <ProjectSetup
            open={setup}
            onClose={() => {
              setSetup(false);
              const id = useProjectStore.getState().activeProjectId;
              if (id && id !== setupProject)
                update({ projectId: id, connectionIds: undefined, contextSelection: undefined });
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
