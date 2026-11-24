import { AgentCharacter } from '@jackalope/brand/agent-character';
import { Button, InlineNotice, Select, SelectItem, Textarea } from '@jackalope/ui';
import { emit, listen } from '@tauri-apps/api/event';
import { FolderOpen } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAgentGaze } from '../../hooks/useAgentGaze';
import { usePromptAttachments } from '../../hooks/usePromptAttachments';
import { useProviderSkills } from '../../hooks/useProviderSkills';
import { navigateWorkspace, useAppEvent } from '../../lib/app-events';
import { startComparison } from '../../lib/compare-launch';
import type { ComposerCommand } from '../../lib/composer-commands';
import { insertDictation, placeCaret } from '../../lib/dictation';
import type { ContextSelection } from '../../lib/knowledge-types';
import { type SessionLimits as Limits, sessionCommand } from '../../lib/live-session';
import { isTauriEnvironment } from '../../lib/native/env';
import { planCommands } from '../../lib/plan-mode';
import { checksAutomatically } from '../../lib/project-automation';
import { appendAttachments } from '../../lib/prompt-attachments';
import { rememberPrompt, storedPrompts } from '../../lib/prompt-history';
import { isQuestionOnly, nonCodeReason } from '../../lib/question-intent';
import { type ReasoningEffort, savedEffort, saveEffort } from '../../lib/reasoning-effort';
import type { RunRequest } from '../../lib/run-types';
import { STARTER_PROMPTS } from '../../lib/starter-prompts';
import {
  ATTACH_ASK_EVENT,
  ATTACH_ASK_RESULT_EVENT,
  type AttachAsk,
  type AttachAskResult,
  type AttachedWindow,
  clearAttached,
  clearDraftAttachments,
  draftAttachKey,
  handOffAttached,
} from '../../lib/window-attach';
import { workspaceRequest } from '../../lib/workspace-mode';
import { useExecutionStore } from '../../stores/executionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { usePlanStore } from '../../stores/planStore';
import {
  agentAccountFor,
  isGeneralProject,
  type Project,
  useProjectStore,
} from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { ComposerEffortPicker, useEffortLevels } from '../composer/ComposerEffortPicker';
import { PastedTextChips } from '../composer/PastedTextChips';
import { useComposerAssist } from '../composer/useComposerAssist';
import { TaskKnowledge } from '../knowledge/TaskKnowledge';
import { AttachButton } from '../tasks/AttachButton';
import { CodexSpeedSelect } from '../tasks/CodexSpeedSelect';
import { SharpenButton, SharpenNotice, useSharpen } from '../tasks/SharpenButton';
import { TaskAssessmentNotice, useTaskAssessment } from '../tasks/useTaskAssessment';
import { DismissButton } from '../ui/DismissButton';
import { VoiceButton } from '../voice/VoiceButton';
import { ChatOptions } from './ChatOptions';
import { ComposerAgentPicker, type ComposerModel, useComposerAgents } from './ComposerAgentPicker';
import { SessionLimits } from './SessionLimits';
import { WindowGlob } from './WindowGlob';
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
  const effortKey = `${draftKey}:effort`;
  const [effort, setEffortState] = useState<ReasoningEffort | null>(() => savedEffort(effortKey));
  const setEffort = useCallback(
    (value: ReasoningEffort | null) => {
      setEffortState(value);
      saveEffort(effortKey, value);
    },
    [effortKey],
  );
  const [effortOpen, setEffortOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  /** Plan mode, toggled with /plan: Send starts a planning interview instead of the work. */
  const [planning, setPlanning] = useState(false);
  const preferred = project?.preferences?.preferredRunner;
  const agents = agentChoice ?? (preferred && preferred !== 'auto' ? [preferred] : []);
  const available = useComposerAgents(project);
  const chosen = agents
    .map((id) => available.find((agent) => agent.id === id))
    .filter((agent) => !!agent);
  const comparing = chosen.length > 1;
  const efforts = useEffortLevels(
    project?.id,
    comparing ? '' : (chosen[0]?.id ?? 'auto'),
    chosen.length === 1 ? modelChoice?.id : undefined,
  );
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
  /** A window attached before Send; it goes to the conversation Send creates. */
  const attachKey = project ? draftAttachKey(project.id) : '';
  const [attached, setAttached] = useState<AttachedWindow | null>(null);
  const [attachRefresh, setAttachRefresh] = useState(0);
  const [attachNotice, setAttachNotice] = useState('');
  const attachMarkRef = useRef<HTMLSpanElement>(null);
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
    edit: (change) => {
      assessment.clear();
      setText(change);
      input.current?.focus();
    },
    room: () => 12000 - [...latest.current].length,
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
  /** The person's choice, from Options, to give inferred non-code work the full code setup. */
  const [treatAsCode, setTreatAsCode] = useState(false);
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
  if (!text.trim() && treatAsCode) setTreatAsCode(false);
  const historyScope = `project:${project?.id ?? 'none'}`;
  const [historyRevision, setHistoryRevision] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read after each send
  const history = useMemo(() => storedPrompts(historyScope), [historyScope, historyRevision]);
  /** Started work replaces the idea it came from and joins this project's prompt history. */
  const finishOrigin = (sent: string) => {
    rememberPrompt(historyScope, sent);
    setHistoryRevision((value) => value + 1);
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
  // A window attached for one project's draft never follows the person to another project.
  useEffect(() => {
    if (!attachKey || !isTauriEnvironment()) return;
    void clearDraftAttachments(attachKey).catch(() => undefined);
  }, [attachKey]);
  const detach = async () => {
    if (!attachKey) return;
    await clearAttached(attachKey).catch(() => undefined);
    setAttachRefresh((value) => value + 1);
  };
  // Clearing the draft detaches its window too.
  const attachedRef = useRef(attached);
  attachedRef.current = attached;
  // biome-ignore lint/correctness/useExhaustiveDependencies: detach only reacts to the draft emptying
  useEffect(() => {
    if (!text.trim() && attachedRef.current) void detach();
  }, [text]);
  /** Comparisons and plans start several runs, so none of them receives the window. */
  const skipAttached = async () => {
    if (!attachedRef.current) return;
    await detach();
    setAttachNotice(
      'Plans and comparisons start several agents, so the attached window was detached. Attach it again in the conversation you want to use it in.',
    );
  };
  /** The last send's error, for a question asked from an attached window's badge. */
  const sendError = useRef('');
  /**
   * Sends the draft; `override` sends that text instead of the composer's. Resolves to
   * the conversation it started, if it started one.
   */
  // A question typed on the attached window's badge becomes this draft's first message.
  useEffect(() => {
    if (!attachKey || !isTauriEnvironment()) return;
    const stop = listen<AttachAsk>(ATTACH_ASK_EVENT, async (event) => {
      if (event.payload.key !== attachKey) return;
      const reply = (result: Omit<AttachAskResult, 'requestId'>) =>
        void emit(ATTACH_ASK_RESULT_EVENT, { requestId: event.payload.requestId, ...result });
      if (comparingRef.current) {
        reply({ error: 'Pick one agent in Jackalope to ask about this window.' });
        return;
      }
      const draft = latest.current.trim();
      const composed = draft ? `${draft}\n\n${event.payload.text}` : event.payload.text;
      latest.current = composed;
      setText(composed);
      const conversation = await sendRef.current('single', composed);
      reply(
        conversation
          ? { conversation }
          : { error: sendError.current || 'Open Jackalope to finish sending it.' },
      );
    });
    return () => void stop.then((unlisten) => unlisten());
  }, [attachKey]);
  const comparingRef = useRef(comparing);
  comparingRef.current = comparing;
  const general = isGeneralProject(project);
  const skills = useProviderSkills(
    chosen.length === 1 ? chosen[0].adapter : undefined,
    project?.id,
  );
  const commands = useMemo(
    () => ({
      model: true,
      effort: efforts.levels.length > 0,
      // Planning needs a repository, which General never has.
      plan: !general && isTauriEnvironment(),
      provider: skills,
    }),
    [efforts.levels.length, general, skills],
  );
  const assist = useComposerAssist({
    input,
    text,
    setText: (value) => {
      assessment.clear();
      setText(value);
    },
    projectPath: project?.path,
    history,
    commands,
    disabled: busy,
    run: (command: ComposerCommand, argument: string) => {
      if (command.id === 'model') setAgentPickerOpen(true);
      else if (command.id === 'effort') setEffortOpen(true);
      else if (command.id === 'plan') {
        if (argument) {
          setText(argument);
          setPlanning(true);
        } else setPlanning((current) => !current);
      }
    },
  });
  /** Non-code work Jackalope inferred, which Options can switch back to code work. */
  const inferredNonCode = !general && !!nonCodeReason(text, { window: !!attached });
  const send = async (
    requested: 'assess' | 'single' | 'plan' | 'interview' = 'assess',
    override?: string,
  ): Promise<string | undefined> => {
    const choice = requested === 'assess' && planning ? 'interview' : requested;
    sendError.current = '';
    const value = (override ?? text).trim();
    if (!project || !value || sending.current) return;
    if (override === undefined && assist.intercept(value)) return;
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
    setAttachNotice('');
    let handedOff = false;
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
        await skipAttached();
        finishOrigin(value);
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
      // Non-code work (General, an attached window, or a request that only reads or operates
      // something outside the code) gets no worktree, preparation or automatic checks.
      const nonCode = !!nonCodeReason(value, {
        general,
        window: !!attachedRef.current,
        treatAsCode,
      });
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
        verifyCommand: origin.readOnly || nonCode ? undefined : project.preferences?.verifyCommand,
        // A question needs no installed dependencies; the agent can prepare if it must.
        prepareCommand:
          origin.readOnly || nonCode || isQuestionOnly(value)
            ? undefined
            : project.preferences?.prepareCommand,
        setupFiles: nonCode ? undefined : project.preferences?.setupFiles,
        autoVerify: !origin.readOnly && !nonCode && checksAutomatically(project.preferences),
        ...(nonCode ? { nonCode } : {}),
        contextSelection: context,
      };
      // The chosen level goes with this work; a conversation takes it on its first message.
      const withEffort = effort ? { ...request, reasoningEffort: effort } : request;
      if (choice === 'interview') {
        const plan = await planCommands.start(withEffort, value);
        await skipAttached();
        localStorage.removeItem(draftKey);
        localStorage.removeItem(`${draftKey}:context`);
        finishOrigin(value);
        if (mounted.current) {
          setText('');
          setPlanning(false);
        }
        usePlanStore.getState().select(plan.id);
        navigateWorkspace('plans');
        return;
      }
      let autoStart = false;
      // An attached window belongs to one conversation, so skip the planning check and start
      // that conversation; planning stays available from Options. Non-code work goes
      // straight to the agent too.
      if (
        choice === 'assess' &&
        !nonCode &&
        !attachedRef.current &&
        !limits.maxBatches &&
        !limits.pauseAtEstimatedUsd
      ) {
        const result = await assessment.assess(request, value);
        autoStart = !!result.autoPlan && project.preferences?.automaticSubtasks !== false;
        if (!autoStart && result.strategy !== 'single') return;
      }
      if (choice === 'plan' || autoStart) {
        await assessment.create(withEffort, value, autoStart);
        await skipAttached();
        finishOrigin(value);
        localStorage.removeItem(draftKey);
        localStorage.removeItem(`${draftKey}:context`);
        return;
      }
      // The conversation's first window request takes the attached window, so it moves
      // before the conversation exists, and back if creating it fails.
      if (attachedRef.current) handedOff = await handOffAttached(attachKey, attempt.id);
      await sessionCommand('create', {
        id: attempt.id,
        request,
        firstMessage: { id: attempt.messageId, text: value, reasoningEffort: effort },
        limits,
      });
      await useLiveSessionStore.getState().refresh(attempt.id);
      finishOrigin(value);
      const next = latest.current.trim() === value ? '' : latest.current;
      if (next) localStorage.setItem(`jackalope-live-draft:main:${attempt.id}`, next);
      saveEffort(`jackalope-live-effort:${attempt.id}`, effort);
      localStorage.removeItem(draftKey);
      localStorage.removeItem(`${draftKey}:context`);
      if (handedOff) setAttachRefresh((value) => value + 1);
      if (mounted.current) useLiveSessionStore.getState().select(attempt.id);
      return attempt.id;
    } catch (cause) {
      if (handedOff) {
        await handOffAttached(attempt.id, attachKey).catch(() => undefined);
        setAttachRefresh((value) => value + 1);
      }
      sendError.current = describeError(cause);
      if (mounted.current) setError(sendError.current);
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const sendRef = useRef(send);
  sendRef.current = send;
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
          {assist.menu}
          <Textarea
            ref={input}
            {...assist.fieldProps}
            aria-label="Message"
            placeholder={planning ? 'What should we plan?' : 'Build, fix, or explore…'}
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
              if (assist.onKeyDown(event)) return;
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <PastedTextChips
            pasted={attachments.pasted}
            onUndo={attachments.undoPaste}
            onDismiss={attachments.dismissPaste}
          />
          {planning && (
            <InlineNotice
              action={
                <Button type="button" variant="ghost" onClick={() => setPlanning(false)}>
                  Leave plan mode
                </Button>
              }
            >
              Plan mode: Send starts a read-only planning conversation before any work.
            </InlineNotice>
          )}
          {error && (
            <InlineNotice tone="error" action={<DismissButton onDismiss={() => setError('')} />}>
              {error}
            </InlineNotice>
          )}
          {attachNotice && (
            <InlineNotice action={<DismissButton onDismiss={() => setAttachNotice('')} />}>
              {attachNotice}
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
              {isTauriEnvironment() && (
                <WindowGlob
                  compact
                  conversation={attachKey}
                  provider={chosen[0]?.id ?? project.preferences?.preferredRunner ?? 'auto'}
                  agent="Jackalope"
                  disabled={busy}
                  mascotRef={attachMarkRef}
                  refresh={attachRefresh}
                  onAttachedChange={setAttached}
                  note="It goes to the conversation you start here; comparisons and plans don’t receive it."
                  onAttached={async (line) => {
                    assessment.clear();
                    setAttachNotice('');
                    setText((current) =>
                      current.trim() ? `${current.trimEnd()}\n\n${line}` : line,
                    );
                    input.current?.focus();
                  }}
                >
                  <AgentCharacter
                    provider={chosen[0]?.id ?? project.preferences?.preferredRunner ?? 'auto'}
                  />
                </WindowGlob>
              )}
              {attachments.available && (
                <AttachButton
                  onPick={() => void attachments.pick()}
                  busy={attachments.busy}
                  disabled={busy}
                />
              )}
              <VoiceButton
                disabled={busy}
                onText={(value) => {
                  assessment.clear();
                  const next = insertDictation(text, value, input.current);
                  setText(next.text);
                  placeCaret(input.current, next.caret);
                }}
              />
              <SharpenButton state={sharpen} draft={text} disabled={busy} />
            </div>
            <div className="live-start-buttons">
              <ComposerAgentPicker
                project={project}
                value={agents}
                open={agentPickerOpen}
                onOpenChange={(open) => {
                  setAgentPickerOpen(open);
                  if (!open) input.current?.focus();
                }}
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
              {!comparing && (
                <ComposerEffortPicker
                  levels={efforts.levels}
                  loaded={efforts.loaded}
                  automatic={!chosen.length}
                  value={effort}
                  onChange={(next) => {
                    assessment.clear();
                    pending.current = null;
                    setEffort(next);
                  }}
                  open={effortOpen}
                  onOpenChange={(open) => {
                    setEffortOpen(open);
                    if (!open) input.current?.focus();
                  }}
                  disabled={busy}
                />
              )}
              <ChatOptions
                triggerVariant="button"
                triggerLabel="Options"
                onClose={() => input.current?.focus()}
                actions={[
                  // Planning needs a repository, which General never has.
                  ...(general
                    ? []
                    : [
                        {
                          id: 'plan-with-me',
                          label: 'Plan with me',
                          disabled: !text.trim() || busy || !isTauriEnvironment(),
                          onSelect: () => void send('interview'),
                        },
                      ]),
                  ...(inferredNonCode
                    ? [
                        {
                          id: 'code-work',
                          label: treatAsCode ? 'Treat as non-code work' : 'Treat as code work',
                          disabled: busy,
                          onSelect: () => {
                            assessment.clear();
                            pending.current = null;
                            setTreatAsCode((current) => !current);
                          },
                        },
                      ]
                    : []),
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
                {planning ? 'Plan' : comparing ? `Start ${chosen.length} tasks` : 'Send'}
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
