import { Input } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { FolderOpen, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { connectionSupport } from '../../lib/agent-capabilities';
import { useAgentModels } from '../../lib/agent-models';
import { planningDraft } from '../../lib/planning';
import { detectSkillsFromPrompt, VETTED_SKILLS } from '../../lib/skills/catalog';
import { assemblePrompt, PROMPT_VERSION } from '../../lib/skills/context-assembler';
import { resolveTaskGuidelines } from '../../lib/skills/task-context';
import { ideaStageLabels } from '../../lib/task-collection';
import { effortPrompt } from '../../lib/task-effort';
import { isTauriEnvironment, listMcpServers, type McpServerConfig } from '../../lib/tauri-bridge';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { emptyDraft, useExecutionStore } from '../../stores/executionStore';
import { useMascotStore } from '../../stores/mascotStore';
import {
  agentAccountFor,
  isAgentAllowedForProject,
  useProjectStore,
} from '../../stores/projectStore';
import { type TaskStatus, useTaskStore } from '../../stores/taskStore';
import { Button } from '../ui/button';
import { ConfirmAction } from '../ui/ConfirmAction';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import { useDialogFocus } from '../ui/useDialogFocus';
import { MultiAgentSplitDialog } from './MultiAgentSplitDialog';
import { ProjectSetup } from './ProjectSetup';
import { TaskComposer } from './TaskComposer';
import { WorkspaceReadiness } from './WorkspaceReadiness';

// The tools panel pulls in the agent, connection and project editors; load it
// only when the user opens it.
const TaskTools = lazy(() => import('./TaskTools').then((m) => ({ default: m.TaskTools })));

export function CaptureTask({
  ideaId,
  agent,
  draftKey,
  onClose,
  onStarted,
  inline = false,
}: {
  ideaId?: string;
  agent?: string;
  draftKey?: string;
  onClose: () => void;
  onStarted: () => void;
  inline?: boolean;
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
      agent: drafts[key]?.agent ?? agent ?? initial.agent,
    };
  }, [idea, projects, activeProjectId, drafts, key, agent]);
  const project = projects.find((p) => p.id === current.projectId);
  const config = useAgentConfigStore();
  const allowed = runners.filter(
    (r) => config.isAgentEnabled(r.id) && isAgentAllowedForProject(project, r.id),
  );
  const defaultAgent = config.defaultMetaAgent;
  const currentAgent = current.agent || defaultAgent;
  const runner = (current.agent ? allowed : runners).find((r) => r.id === currentAgent);
  const [splitOpen, setSplitOpen] = useState(false);
  const [toolRevision, setToolRevision] = useState(0);
  const adapter = config.customAgents.find((a) => a.id === currentAgent)?.adapter ?? currentAgent;
  const modelCatalog = useAgentModels(
    current.agent ? currentAgent : '',
    toolRevision,
    agentAccountFor(project, adapter),
  );
  const modelOptions = config.runnerOptions[currentAgent];
  const defaultModel =
    modelCatalog.catalog?.source === 'local'
      ? (modelCatalog.catalog.models[0]?.id ?? '')
      : modelOptions?.defaultModel ||
        (modelOptions?.restrictModels ? modelOptions.models[0] : '') ||
        '';
  const models = (modelCatalog.catalog?.models ?? [])
    .map((model) => model.id)
    .filter(
      (model) =>
        config.isModelAllowed(model) &&
        config.isModelAllowed(`${currentAgent}:${model}`) &&
        (!modelOptions?.restrictModels || modelOptions.models.includes(model)),
    );
  const modelError =
    !modelCatalog.loading && current.agent && current.model && !models.includes(current.model)
      ? 'The saved task model could not be verified. Under Customize task → Agent, choose an available model or clear the task override.'
      : !modelCatalog.loading &&
          current.agent &&
          !current.model &&
          defaultModel &&
          !models.includes(defaultModel)
        ? 'The configured default model could not be verified. Choose an available task model or reset model preferences in agent settings.'
        : '';
  const [error, setError] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [setup, setSetup] = useState(false);
  const [setupProject, setSetupProject] = useState<string | null>(null);
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const connections = servers.filter(
    (s) => s.enabled !== false && s.scope === `project:${project?.id}`,
  );
  const connectionIssues = Object.fromEntries(
    connections.flatMap((server) => {
      const reason = current.agent
        ? connectionSupport(adapter, server.transport, server.discovery === true)
        : null;
      return reason ? [[server.id, reason]] : [];
    }),
  );
  const incompatible = connections.filter(
    (server) =>
      connectionIssues[server.id] &&
      (!current.connectionIds || current.connectionIds.includes(server.id)),
  );
  const toolError = incompatible.length
    ? `${incompatible.map((server) => server.name).join(', ')} cannot be used with this agent. Under Customize task, choose automatic routing or update the project connection settings.`
    : '';
  const [loadedProject, setLoadedProject] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const desktop = isTauriEnvironment();
  useEffect(() => {
    // Ordinary navigation preserves the draft; the project switcher explicitly retargets capture.
    if (!inline && useExecutionStore.getState().drafts[key]?.projectId === undefined)
      draft(key, current);
  }, [inline, key, current, draft]);
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
    if (agent) draft(key, { agent, model: undefined });
  }, [agent, key, draft]);
  const update = (value: Partial<typeof current>) => draft(key, { ...current, ...value });
  const skills = resolveTaskGuidelines(current.prompt, current.skills, project?.preferences);
  const assembled = assemblePrompt({
    rawPrompt: current.prompt.trim(),
    selectedSkillIds: skills,
    executionMode: current.isolated ? 'isolated' : 'current',
  });
  const instructions = project?.preferences?.customInstructions?.trim();
  const finalPrompt = [
    assembled.assembledPrompt || current.prompt.trim(),
    instructions ? `[Project Guidelines]:\n${instructions}` : '',
    effortPrompt(current.effort),
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
      promptVersion: PROMPT_VERSION,
      assignedAgent: current.agent || undefined,
      effort: current.effort,
      model: current.model,
      connectionIds: current.connectionIds,
      contextSelection: current.contextSelection,
      clarifications: [
        ...(idea?.clarifications?.filter(
          (item) =>
            !['Active Skill Guidelines', 'Git Execution Mode', 'Task guideline selection'].includes(
              item.question,
            ),
        ) ?? []),
        {
          question: 'Task guideline selection',
          answer: current.skills === undefined ? 'Automatic' : 'Manual',
        },
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
      modelError ||
      modelCatalog.loading ||
      toolError ||
      !current.prompt.trim()
    )
      return;
    setError('');
    try {
      const id = await start({
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        agent: current.agent ? currentAgent : 'auto',
        model: current.agent ? current.model : undefined,
        agentProfileId: current.agent ? agentAccountFor(project, adapter) : undefined,
        targetBranch: project.preferences?.baseBranch || project.gitBranch,
        verifyCommand: project.preferences?.verifyCommand,
        prepareCommand: project.preferences?.prepareCommand,
        autoVerify: project.preferences?.autoVerify === true,
        prompt: finalPrompt,
        effort: current.effort ?? 'balanced',
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
  const content = (
    <>
      <TaskComposer
        inline={inline}
        workspaceSetup={project && <WorkspaceReadiness key={project.id} project={project} />}
        setup={
          <Button
            type="button"
            variant="ghost"
            className="mt-3"
            onClick={() => {
              if (project) selectProject(project.id);
              setToolsOpen(true);
            }}
          >
            Agent & tool settings
          </Button>
        }
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
                    model: undefined,
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
                type="button"
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
            {!project && current.projectId && (
              <p className="task-muted mb-4">Project unavailable. Choose another project.</p>
            )}
          </>
        }
        current={current}
        models={models}
        defaultModel={defaultModel}
        modelNotice={
          modelCatalog.loading
            ? 'Reading available models…'
            : modelCatalog.error ||
              (!models.length
                ? 'No available models could be detected or allowed. Model selection is unavailable; check the agent sign-in and model preferences.'
                : modelCatalog.catalog?.detail)
        }
        modelNames={Object.fromEntries(
          (modelCatalog.catalog?.models ?? []).map((model) => [model.id, model.name]),
        )}
        automaticAgent={runners.find((r) => r.id === defaultAgent)?.name}
        onSplitTask={project ? () => setSplitOpen(true) : undefined}
        runner={runner}
        allowedRunners={allowed}
        submitting={submitting}
        desktop={
          desktop &&
          !!project &&
          loadedProject === `${project.id}:${toolRevision}` &&
          !connectionError &&
          !modelError &&
          !modelCatalog.loading &&
          !toolError
        }
        activeSkills={skills}
        suggestedSkills={detectSkillsFromPrompt(current.prompt).map((s) => s.id)}
        projectInstructions={instructions}
        finalPrompt={finalPrompt}
        projectConnections={connections}
        connectionIssues={connectionIssues}
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
          if (inline) {
            useMascotStore.getState().say('Idea saved for later.', 3500);
            requestAnimationFrame(() => document.getElementById('task-intent')?.focus());
          }
          onClose();
        }}
      />
      {idea && (
        <details className="mt-4">
          <summary>Idea details</summary>
          <label className="task-label mt-4" htmlFor="capture-title">
            Title
          </label>
          <Input
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
          <span>{runner?.detail || 'Connect an agent to start. You can save this idea now.'}</span>
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
      {(error || connectionError || modelError || toolError) && (
        <InlineNotice tone="error" className="mt-4">
          {error || connectionError || modelError || toolError}
        </InlineNotice>
      )}
      <ProjectSetup
        open={setup}
        onClose={() => {
          setSetup(false);
          const id = useProjectStore.getState().activeProjectId;
          if (id && id !== setupProject)
            update({
              projectId: id,
              model: undefined,
              connectionIds: undefined,
              contextSelection: undefined,
            });
        }}
      />
      {project && (
        <MultiAgentSplitDialog
          open={splitOpen}
          onClose={() => setSplitOpen(false)}
          goal={current.prompt}
          project={project}
          runners={allowed}
          onImported={() => {
            setSplitOpen(false);
            clear();
            onClose();
          }}
        />
      )}
    </>
  );
  if (inline) return <div className="task-inline-capture">{content}</div>;
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
          <Dialog.Description className="sr-only">
            Configure a task or save an idea.
          </Dialog.Description>
          {content}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
