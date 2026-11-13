import { AgentCharacter } from '@jackalope/brand/agent-character';
import { Button, InlineNotice, Select, SelectItem, Textarea } from '@jackalope/ui';
import { FolderOpen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAgentGaze } from '../../hooks/useAgentGaze';
import { usePromptAttachments } from '../../hooks/usePromptAttachments';
import { navigateWorkspace, useAppEvent } from '../../lib/app-events';
import { startComparison } from '../../lib/compare-launch';
import type { ContextSelection } from '../../lib/knowledge-types';
import { type SessionLimits as Limits, sessionCommand } from '../../lib/live-session';
import { isTauriEnvironment } from '../../lib/native/env';
import { planCommands } from '../../lib/plan-mode';
import { appendAttachments } from '../../lib/prompt-attachments';
import { isQuestionOnly } from '../../lib/question-intent';
import type { RunRequest } from '../../lib/run-types';
import { STARTER_PROMPTS } from '../../lib/starter-prompts';
import { workspaceRequest } from '../../lib/workspace-mode';
import { useExecutionStore } from '../../stores/executionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { usePlanStore } from '../../stores/planStore';
import { agentAccountFor, type Project, useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { TaskKnowledge } from '../knowledge/TaskKnowledge';
import { AttachButton } from '../tasks/AttachButton';
import { CodexSpeedSelect } from '../tasks/CodexSpeedSelect';
import { DictationButton } from '../tasks/DictationButton';
import { SharpenButton, SharpenNotice, useSharpen } from '../tasks/SharpenButton';
import { TaskAssessmentNotice, useTaskAssessment } from '../tasks/useTaskAssessment';
import { DismissButton } from '../ui/DismissButton';
import { ChatOptions } from './ChatOptions';
import { ComposerAgentPicker, type ComposerModel, useComposerAgents } from './ComposerAgentPicker';
import { SessionLimits } from './SessionLimits';
import { WorkflowStarter } from './WorkflowStarter';
import './live-session.css';
import { describeError } from '@jackalope/contracts/errors';
import { selectWork } from '../../lib/work-selection';

/** Saved work handed to the composer: a draft, an idea or an agent choice. */
export interface ComposerSeed {
  id: string;
  text: string;
  agent?: string;
  contextSelection?: ContextSelection;
  /** A review helper: no prepare command and no automatic checks. */
  readOnly?: boolean;
  /** The saved idea this replaces once the work starts. */
  ideaId?: string;
  draftKey?: string;
}

export function SessionStart({
  project,
  onOpenProject,
  embedded = false,
  starters = false,
  seed,
  onSeedApplied,
}: {
  project?: Project;
  onOpenProject: () => void;
  embedded?: boolean;
  /** Offers editable first requests while the draft is empty. */
  starters?: boolean;
  seed?: ComposerSeed | null;
  onSeedApplied?: (seed: ComposerSeed) => void;
}) {
  const draftKey = `jackalope-live-start:${project?.id ?? 'none'}`;
  const assessment = useTaskAssessment();
  const [text, setText] = useState(() => localStorage.getItem(draftKey) ?? '');
  const [context, setContext] = useState<ContextSelection>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`${draftKey}:context`) ?? '{}');
      return {
        memoryOff: saved?.memoryOff === true,
        excludedMemoryIds: Array.isArray(saved?.excludedMemoryIds)
          ? saved.excludedMemoryIds.filter((id: unknown) => typeof id === 'string')
          : [],
      };
    } catch {
      return {};
    }
  });
  const [codexSpeed, setCodexSpeed] = useState<RunRequest['codexSpeed']>(() => {
    const saved = localStorage.getItem(`${draftKey}:codex-speed`);
    return saved === 'fast' || saved === 'standard' ? saved : undefined;
  });
  // An explicit choice is saved with the draft; otherwise the project default applies.
  const [agentChoice, setAgents] = useState<string[] | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`${draftKey}:agents`) ?? 'null');
      if (Array.isArray(saved) && saved.every((id) => typeof id === 'string')) return saved;
    } catch {}
    return null;
  });
  const [modelChoice, setModel] = useState<ComposerModel | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`${draftKey}:model`) ?? 'null');
      if (typeof saved?.id === 'string' && typeof saved?.name === 'string') return saved;
    } catch {}
    return null;
  });
  const preferred = project?.preferences?.preferredRunner;
  const agents = agentChoice ?? (preferred && preferred !== 'auto' ? [preferred] : []);
  const available = useComposerAgents(project);
  const chosen = agents
    .map((id) => available.find((agent) => agent.id === id))
    .filter((agent) => !!agent);
  const comparing = chosen.length > 1;
  const [busy, setBusy] = useState(false);
  const [limits, setLimits] = useState<Limits>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`${draftKey}:limits`) ?? '{}');
      return {
        maxBatches:
          Number.isInteger(saved?.maxBatches) && saved.maxBatches > 0 && saved.maxBatches <= 1000
            ? saved.maxBatches
            : null,
        pauseAtEstimatedUsd:
          typeof saved?.pauseAtEstimatedUsd === 'number' &&
          saved.pauseAtEstimatedUsd > 0 &&
          saved.pauseAtEstimatedUsd <= 100000
            ? saved.pauseAtEstimatedUsd
            : null,
      };
    } catch {
      return { maxBatches: null, pauseAtEstimatedUsd: null };
    }
  });
  const [error, setError] = useState('');
  const [isFocused, setIsFocused] = useState(true);
  const markRef = useRef<HTMLDivElement>(null);
  const gaze = useAgentGaze(markRef, { text, isFocused });
  const input = useRef<HTMLTextAreaElement>(null);
  const composer = useRef<HTMLFormElement>(null);
  const attachments = usePromptAttachments({
    projectPath: project?.path,
    target: composer,
    disabled: busy,
    onAttach: (references) => {
      assessment.clear();
      setText((current) => appendAttachments(current, references));
      input.current?.focus();
    },
  });
  const clearAssessment = useRef(assessment.clear);
  clearAssessment.current = assessment.clear;
  useAppEvent('attach-to-composer', (references) => {
    if (!Array.isArray(references)) return;
    clearAssessment.current();
    setText((current) => appendAttachments(current, references));
    input.current?.focus();
  });
  const latest = useRef(text);
  const sharpen = useSharpen({
    draft: text,
    apply: (value) => {
      assessment.clear();
      pending.current = null;
      setText(value);
      input.current?.focus();
    },
    current: () => latest.current,
    project: project && { id: project.id, name: project.name },
    maxChars: 12000,
  });
  const [origin, setOrigin] = useState<{ readOnly?: boolean; ideaId?: string }>({});
  const seedApplied = useRef(onSeedApplied);
  seedApplied.current = onSeedApplied;
  useEffect(() => {
    if (!seed) return;
    const incoming = seed.text.trim();
    if (incoming)
      setText((current) =>
        current.trim() && current.trim() !== incoming
          ? `${current}

${incoming}`
          : incoming,
      );
    if (seed.agent) setAgents([seed.agent]);
    if (seed.contextSelection) setContext(seed.contextSelection);
    setOrigin({ readOnly: seed.readOnly, ideaId: seed.ideaId });
    clearAssessment.current();
    seedApplied.current?.(seed);
    input.current?.focus();
  }, [seed]);
  if (!text.trim() && (origin.readOnly || origin.ideaId)) setOrigin({});
  /** Started work replaces the idea it came from. */
  const finishOrigin = () => {
    if (origin.ideaId) useTaskStore.getState().deleteTask(origin.ideaId);
    if (mounted.current) setOrigin({});
  };
  const mounted = useRef(true);
  const pending = useRef<{ id: string; messageId: string; text: string } | null>(null);
  const sending = useRef(false);
  latest.current = text;
  useEffect(() => {
    mounted.current = true;
    input.current?.focus();
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      if (text) localStorage.setItem(draftKey, text);
      else localStorage.removeItem(draftKey);
      localStorage.setItem(`${draftKey}:context`, JSON.stringify(context));
      localStorage.setItem(`${draftKey}:limits`, JSON.stringify(limits));
      if (codexSpeed) localStorage.setItem(`${draftKey}:codex-speed`, codexSpeed);
      else localStorage.removeItem(`${draftKey}:codex-speed`);
      if (agentChoice) localStorage.setItem(`${draftKey}:agents`, JSON.stringify(agentChoice));
      else localStorage.removeItem(`${draftKey}:agents`);
      if (modelChoice) localStorage.setItem(`${draftKey}:model`, JSON.stringify(modelChoice));
      else localStorage.removeItem(`${draftKey}:model`);
    } catch {
      setError('This draft could not be saved. Keep this page open until sending succeeds.');
    }
  }, [draftKey, text, context, limits, codexSpeed, agentChoice, modelChoice]);
  const send = async (choice: 'assess' | 'single' | 'plan' | 'interview' = 'assess') => {
    const value = text.trim();
    if (!project || !value || sending.current) return;
    if ([...value].length > 12000) {
      setError(
        'This request is too long. Shorten it to 12,000 characters before sending. Your draft is preserved.',
      );
      return;
    }
    if (!pending.current || pending.current.text !== value)
      pending.current = { id: crypto.randomUUID(), messageId: crypto.randomUUID(), text: value };
    const attempt = pending.current;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      if (comparing && choice !== 'interview') {
        const comparison = await startComparison({
          project,
          prompt: value,
          agents: chosen,
          contextSelection: context,
          codexSpeed,
        });
        localStorage.removeItem(draftKey);
        localStorage.removeItem(`${draftKey}:context`);
        // A comparison is a one-off choice; the next message goes back to the project default.
        localStorage.removeItem(`${draftKey}:agents`);
        finishOrigin();
        if (mounted.current) {
          setText(latest.current.trim() === value ? '' : latest.current);
          setAgents(null);
        }
        // The composer can unmount once work exists, so open the first attempt regardless.
        const first = useExecutionStore
          .getState()
          .runs.find((run) => run.taskId === comparison.taskIds[0]);
        if (first) selectWork({ task: first.id });
        return;
      }
      const lead = chosen[0];
      const agent = lead?.id ?? 'auto';
      const request: RunRequest = {
        id: attempt.id,
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        agent,
        model: lead && chosen.length === 1 ? modelChoice?.id : undefined,
        codexSpeed,
        agentProfileId: lead ? agentAccountFor(project, lead.adapter) : undefined,
        prompt: value,
        ...workspaceRequest(project),
        targetBranch: project.preferences?.baseBranch || project.gitBranch,
        verifyCommand: origin.readOnly ? undefined : project.preferences?.verifyCommand,
        // A question needs no installed dependencies; the agent can prepare if it must.
        prepareCommand:
          origin.readOnly || isQuestionOnly(value)
            ? undefined
            : project.preferences?.prepareCommand,
        setupFiles: project.preferences?.setupFiles,
        autoVerify: !origin.readOnly && (project.preferences?.autoVerify ?? true),
        contextSelection: context,
      };
      if (choice === 'interview') {
        const plan = await planCommands.start(request, value);
        localStorage.removeItem(draftKey);
        localStorage.removeItem(`${draftKey}:context`);
        finishOrigin();
        if (mounted.current) setText('');
        usePlanStore.getState().select(plan.id);
        navigateWorkspace('plans');
        return;
      }
      let autoStart = false;
      if (choice === 'assess' && !limits.maxBatches && !limits.pauseAtEstimatedUsd) {
        const result = await assessment.assess(request, value);
        autoStart = !!result.autoPlan && project.preferences?.automaticSubtasks !== false;
        if (!autoStart && result.strategy !== 'single') return;
      }
      if (choice === 'plan' || autoStart) {
        await assessment.create(request, value, autoStart);
        finishOrigin();
        localStorage.removeItem(draftKey);
        localStorage.removeItem(`${draftKey}:context`);
        return;
      }
      await sessionCommand('create', {
        id: attempt.id,
        request,
        firstMessage: { id: attempt.messageId, text: value },
        limits,
      });
      await useLiveSessionStore.getState().refresh(attempt.id);
      finishOrigin();
      const next = latest.current.trim() === value ? '' : latest.current;
      if (next) localStorage.setItem(`jackalope-live-draft:main:${attempt.id}`, next);
      localStorage.removeItem(draftKey);
      localStorage.removeItem(`${draftKey}:context`);
      if (mounted.current) useLiveSessionStore.getState().select(attempt.id);
    } catch (cause) {
      if (mounted.current) setError(describeError(cause));
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <div className={`live-start${embedded ? ' live-start-embedded' : ''}`}>
      {!embedded && (
        <>
          <div className="live-start-mark" aria-hidden="true" ref={markRef}>
            <AgentCharacter
              provider={project?.preferences?.preferredRunner || 'auto'}
              gaze={gaze}
            />
          </div>
          <span className="live-start-label">New work</span>
          <h2>{project?.name ?? 'Choose a project'}</h2>
        </>
      )}
      {project ? (
        <form
          ref={composer}
          className="live-start-composer"
          data-dragging={attachments.dragging || undefined}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Textarea
            ref={input}
            aria-label="Message"
            placeholder="Build, fix, or explore…"
            rows={3}
            maxLength={12000}
            value={text}
            readOnly={sharpen.busy}
            onChange={(event) => {
              assessment.clear();
              setText(event.target.value);
            }}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onPaste={attachments.onPaste}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
          />
          {error && (
            <InlineNotice tone="error" action={<DismissButton onDismiss={() => setError('')} />}>
              {error}
            </InlineNotice>
          )}
          <SharpenNotice state={sharpen} />
          {attachments.error && (
            <InlineNotice
              tone="error"
              action={<DismissButton onDismiss={attachments.clearError} />}
            >
              {attachments.error}
            </InlineNotice>
          )}
          <TaskAssessmentNotice
            assessment={assessment.assessment}
            busy={assessment.busy}
            onCancel={() => void assessment.cancel()}
            onSingle={() => void send('single')}
            onPlan={() => void send('plan')}
            onPlanWithMe={() => void send('interview')}
          />
          <div className="live-start-actions">
            <div className="live-start-tools">
              {attachments.available && (
                <AttachButton
                  onPick={() => void attachments.pick()}
                  busy={attachments.busy}
                  disabled={busy}
                />
              )}
              <DictationButton
                disabled={busy}
                onText={(value) => {
                  assessment.clear();
                  setText((current) => (current.trim() ? `${current}\n${value}` : value));
                  input.current?.focus();
                }}
              />
              <SharpenButton state={sharpen} draft={text} disabled={busy} />
            </div>
            <div className="live-start-buttons">
              <ComposerAgentPicker
                project={project}
                value={agents}
                model={modelChoice}
                onModelChange={(next) => {
                  assessment.clear();
                  pending.current = null;
                  setModel(next);
                }}
                disabled={busy}
                onChange={(next) => {
                  assessment.clear();
                  pending.current = null;
                  setAgents(next);
                }}
              />
              <ChatOptions
                triggerVariant="button"
                triggerLabel="Options"
                onClose={() => input.current?.focus()}
                actions={[
                  {
                    id: 'plan-with-me',
                    label: 'Plan with me',
                    disabled: !text.trim() || busy || !isTauriEnvironment(),
                    onSelect: () => void send('interview'),
                  },
                ]}
                items={[
                  {
                    id: 'speed',
                    label: 'Codex speed',
                    content: () => (
                      <CodexSpeedSelect
                        disabled={busy}
                        value={codexSpeed}
                        onChange={(value) => {
                          assessment.clear();
                          pending.current = null;
                          setCodexSpeed(value);
                        }}
                      />
                    ),
                  },
                  {
                    id: 'limits',
                    label: 'Conversation limits',
                    content: () => (
                      <SessionLimits
                        embedded
                        initial={limits}
                        onSave={(next) => {
                          assessment.clear();
                          setLimits(next);
                        }}
                      />
                    ),
                  },
                  {
                    id: 'workflow',
                    label: 'Start from a repeatable workflow',
                    content: (close) => (
                      <WorkflowStarter
                        embedded
                        projectPath={project.path}
                        onDraft={(prompt) => {
                          assessment.clear();
                          setText((current) =>
                            current.trim() ? `${current}\n\n${prompt}` : prompt,
                          );
                          close();
                        }}
                      />
                    ),
                  },
                  {
                    id: 'context',
                    label: 'Saved project context',
                    content: () => (
                      <TaskKnowledge
                        embedded
                        projectId={project.id}
                        projectPath={project.path}
                        prompt={text}
                        selection={context}
                        onChange={(next) => {
                          assessment.clear();
                          setContext(next);
                        }}
                        allowWorkflows={false}
                      />
                    ),
                  },
                ]}
              />
              <Button
                type="submit"
                disabled={!text.trim() || busy || !isTauriEnvironment()}
                loading={busy}
                loadingLabel="Starting…"
              >
                {comparing ? `Start ${chosen.length} tasks` : 'Send'}
              </Button>
            </div>
          </div>
        </form>
      ) : null}
      {project && starters && !text.trim() && (
        <fieldset className="starter-chips" aria-label="Ideas to start with">
          {STARTER_PROMPTS.map((starter) => (
            <button
              key={starter.label}
              type="button"
              className="starter-chip"
              onClick={() => {
                assessment.clear();
                setText(starter.prompt);
                input.current?.focus();
              }}
            >
              {starter.label}
            </button>
          ))}
        </fieldset>
      )}
      {project ? null : <ProjectPick onOpenProject={onOpenProject} />}
    </div>
  );
}

/**
 * Without a project in focus, new work first needs one: pick an existing project, or
 * add one when there are none yet.
 */
function ProjectPick({ onOpenProject }: { onOpenProject: () => void }) {
  const projects = useProjectStore((state) => state.projects);
  if (!projects.length)
    return (
      <Button variant="outline" onClick={onOpenProject}>
        <FolderOpen size={16} />
        Open project
      </Button>
    );
  return (
    <div className="live-start-pick">
      <Select
        aria-label="Project for new work"
        placeholder="Choose a project for new work"
        onValueChange={(id) => useProjectStore.getState().selectProject(id)}
      >
        {projects.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.name}
          </SelectItem>
        ))}
      </Select>
    </div>
  );
}
