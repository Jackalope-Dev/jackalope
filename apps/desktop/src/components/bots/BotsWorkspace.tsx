import { AgentCharacter } from '@jackalope/brand/agent-character';
import {
  Badge,
  ConfirmDialog,
  FormField,
  Input,
  DropdownMenu as Menu,
  Switch,
  Textarea,
} from '@jackalope/ui';
import { CalendarClock, MessageSquare, MoreHorizontal, Pin, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { BOT_TEMPLATES, type BotTemplate } from '../../lib/bot-templates';
import { type LiveSession, sessionCommand } from '../../lib/live-session';
import { scheduleTimingExpression } from '../../lib/schedules';
import { nativeTask, type RunRequest } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import {
  type Bot,
  type BotDraft,
  rosterOrder,
  routinePrompt,
  useBotStore,
} from '../../stores/botStore';
import { useExecutionStore } from '../../stores/executionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { agentAccountFor, type Project, useProjectStore } from '../../stores/projectStore';
import { navigateWorkspace } from '../layout/navigation';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import { BotEditor } from './BotEditor';
import './bots.css';

interface ScheduleLedger {
  schedules: {
    definition: { id: string; name: string; enabled: boolean; expression: string };
    nextAt: string;
  }[];
}

function blankDraft(projectId: string, template?: BotTemplate): BotDraft {
  return {
    name: template?.name ?? '',
    role: template?.role ?? '',
    instructions: template?.instructions ?? '',
    agent: 'auto',
    model: null,
    projectId,
    connectionIds: null,
  };
}

/** Builds the run request a bot's conversation or routine starts with. */
function botRequest(bot: Bot, project: Project, id: string, prompt: string): RunRequest {
  const adapter =
    useAgentConfigStore.getState().customAgents.find((agent) => agent.id === bot.agent)?.adapter ??
    bot.agent;
  return {
    id,
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path,
    agent: bot.agent,
    model: bot.agent === 'auto' ? undefined : bot.model?.id,
    agentProfileId: bot.agent === 'auto' ? undefined : agentAccountFor(project, adapter),
    connectionIds: bot.connectionIds ?? undefined,
    prompt,
    isolated: true,
    targetBranch: project.preferences?.baseBranch || project.gitBranch,
    verifyCommand: project.preferences?.verifyCommand,
    prepareCommand: project.preferences?.prepareCommand,
    setupFiles: project.preferences?.setupFiles,
    autoVerify: project.preferences?.autoVerify ?? true,
  };
}

/** Opens a conversation in Work, switching to its project first. */
function openConversation(session: Pick<LiveSession, 'id' | 'request'>) {
  useProjectStore.getState().selectProject(session.request.projectId);
  useLiveSessionStore.getState().select(session.id);
  navigateWorkspace('live-sessions');
}

export function BotsWorkspace() {
  const { bots, selectedId } = useBotStore(
    useShallow((state) => ({ bots: state.bots, selectedId: state.selectedId })),
  );
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const sessions = useLiveSessionStore((state) => state.sessions);
  const [editing, setEditing] = useState<{ bot?: Bot; draft: BotDraft } | null>(null);
  const [deleting, setDeleting] = useState<Bot | null>(null);
  const roster = useMemo(() => rosterOrder(bots), [bots]);
  const selected = bots.find((bot) => bot.id === selectedId) ?? roster[0];
  const defaultProject = activeProjectId ?? projects[0]?.id ?? '';
  useEffect(() => {
    if (isTauriEnvironment()) void useLiveSessionStore.getState().refresh(null);
  }, []);
  const conversationsFor = useCallback(
    (bot: Bot) =>
      sessions
        .filter((session) => session.persona?.botId === bot.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [sessions],
  );
  const startNew = (template?: BotTemplate) =>
    setEditing({ draft: blankDraft(defaultProject, template) });
  return (
    <WorkspacePage className="bots-page">
      <WorkspaceHeading
        title="Bots"
        description="Saved agents with their own role, model and apps. Message a bot to start a conversation with it."
        action={
          bots.length > 0 && (
            <Button onClick={() => startNew()} disabled={!projects.length}>
              <Plus size={16} aria-hidden="true" />
              New bot
            </Button>
          )
        }
      />
      {!projects.length && (
        <InlineNotice>Add a project first. Each bot works inside one project.</InlineNotice>
      )}
      {bots.length === 0 ? (
        <BotTemplates
          disabled={!projects.length}
          onUse={(template) => startNew(template)}
          onBlank={() => startNew()}
        />
      ) : (
        <div className="bots-layout">
          <nav className="bots-roster" aria-label="Bots">
            {roster.map((bot) => {
              const latest = conversationsFor(bot)[0];
              return (
                <div
                  key={bot.id}
                  className="bots-roster-item"
                  data-selected={bot.id === selected?.id || undefined}
                >
                  <button
                    type="button"
                    className="bots-roster-open"
                    aria-current={bot.id === selected?.id ? 'true' : undefined}
                    onClick={() => useBotStore.getState().select(bot.id)}
                  >
                    <span className="bots-avatar" aria-hidden="true">
                      <AgentCharacter provider={bot.agent} />
                    </span>
                    <span className="bots-roster-copy">
                      <strong>
                        {bot.name}
                        {bot.pinned && <Pin size={12} aria-label="Pinned" />}
                      </strong>
                      <small>{latest?.title ?? (bot.role || 'No conversations yet')}</small>
                    </span>
                  </button>
                  <BotMenu
                    bot={bot}
                    onEdit={() => setEditing({ bot, draft: bot })}
                    onDelete={() => setDeleting(bot)}
                  />
                </div>
              );
            })}
          </nav>
          {selected && (
            <BotProfile
              key={selected.id}
              bot={selected}
              project={projects.find((project) => project.id === selected.projectId)}
              conversations={conversationsFor(selected)}
              onEdit={() => setEditing({ bot: selected, draft: selected })}
            />
          )}
        </div>
      )}
      {editing && (
        <BotEditor
          bot={editing.bot}
          initial={editing.draft}
          onClose={() => setEditing(null)}
          onSave={(draft) => {
            const store = useBotStore.getState();
            if (editing.bot) store.update(editing.bot.id, draft);
            else store.create(draft);
            setEditing(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={`Delete ${deleting.name}?`}
          description="Its conversations stay in Work and its routines stay in Automations. Only the saved bot is removed."
          label="Delete bot"
          onConfirm={() => {
            useBotStore.getState().remove(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </WorkspacePage>
  );
}

function BotTemplates({
  disabled,
  onUse,
  onBlank,
}: {
  disabled: boolean;
  onUse: (template: BotTemplate) => void;
  onBlank: () => void;
}) {
  return (
    <section className="workspace-section workspace-stack">
      <WorkspaceSectionHeading
        title="Start from a template"
        description="Every field stays editable. Templates never grant access or start work."
      />
      <ul className="bots-templates">
        {BOT_TEMPLATES.map((template) => (
          <li key={template.id} className="bots-template">
            <span className="bots-avatar" aria-hidden="true">
              <AgentCharacter provider="auto" />
            </span>
            <div>
              <strong>{template.name}</strong>
              <p>{template.role}</p>
            </div>
            <Button variant="outline" disabled={disabled} onClick={() => onUse(template)}>
              Use template
            </Button>
          </li>
        ))}
      </ul>
      <div>
        <Button disabled={disabled} onClick={onBlank}>
          <Plus size={16} aria-hidden="true" />
          Start from scratch
        </Button>
      </div>
    </section>
  );
}

function BotMenu({
  bot,
  onEdit,
  onDelete,
}: {
  bot: Bot;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button type="button" className="bots-roster-more" aria-label={`${bot.name} options`}>
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="workspace-menu" align="end" sideOffset={6}>
          <Menu.Item
            className="workspace-menu-item"
            onSelect={() => useBotStore.getState().togglePin(bot.id)}
          >
            {bot.pinned ? 'Unpin' : 'Pin to top'}
          </Menu.Item>
          <Menu.Item className="workspace-menu-item" onSelect={onEdit}>
            Edit bot
          </Menu.Item>
          <Menu.Item
            className="workspace-menu-item"
            onSelect={() => useBotStore.getState().duplicate(bot.id)}
          >
            Duplicate
          </Menu.Item>
          <Menu.Separator className="menu-separator" />
          <Menu.Item className="workspace-menu-item" onSelect={onDelete}>
            Delete bot…
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function BotProfile({
  bot,
  project,
  conversations,
  onEdit,
}: {
  bot: Bot;
  project?: Project;
  conversations: LiveSession[];
  onEdit: () => void;
}) {
  const runners = useExecutionStore((state) => state.runners);
  const agentName =
    bot.agent === 'auto'
      ? 'Automatic'
      : (runners.find((runner) => runner.id === bot.agent)?.name ?? bot.agent);
  const draftKey = `jackalope-bot-draft:${bot.id}`;
  const [text, setText] = useState(() => localStorage.getItem(draftKey) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<{ id: string; messageId: string; text: string } | null>(null);
  useEffect(() => {
    try {
      if (text) localStorage.setItem(draftKey, text);
      else localStorage.removeItem(draftKey);
    } catch {}
  }, [draftKey, text]);
  const send = async () => {
    const value = text.trim();
    if (!value || !project || busy) return;
    if (new TextEncoder().encode(value).length > 12000) {
      setError('Shorten this message to 12,000 UTF-8 bytes. Your draft is preserved.');
      return;
    }
    // Retrying the same text reuses identifiers so a slow first attempt cannot duplicate it.
    if (!pending.current || pending.current.text !== value)
      pending.current = { id: crypto.randomUUID(), messageId: crypto.randomUUID(), text: value };
    const attempt = pending.current;
    setBusy(true);
    setError('');
    try {
      await syncAgentConfig();
      await sessionCommand('create', {
        id: attempt.id,
        request: botRequest(bot, project, attempt.id, value),
        firstMessage: { id: attempt.messageId, text: value },
        limits: { maxBatches: null, pauseAtEstimatedUsd: null },
        persona: { botId: bot.id, name: bot.name, instructions: bot.instructions },
      });
      setText('');
      pending.current = null;
      await useLiveSessionStore.getState().refresh(attempt.id);
      openConversation({ id: attempt.id, request: botRequest(bot, project, attempt.id, value) });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="bots-profile" aria-label={bot.name}>
      <header className="bots-profile-header">
        <span className="bots-avatar bots-avatar-large" aria-hidden="true">
          <AgentCharacter provider={bot.agent} />
        </span>
        <div className="bots-profile-identity">
          <h2>{bot.name}</h2>
          {bot.role && <p>{bot.role}</p>}
          <div className="bots-profile-meta">
            <Badge>
              {agentName}
              {bot.agent !== 'auto' && bot.model ? ` · ${bot.model.name}` : ''}
            </Badge>
            <Badge appearance="plain">{project?.name ?? 'Project unavailable'}</Badge>
            <Badge appearance="plain">
              {bot.connectionIds === null
                ? 'All connections'
                : `${bot.connectionIds.length} ${bot.connectionIds.length === 1 ? 'connection' : 'connections'}`}
            </Badge>
          </div>
        </div>
        <Button variant="outline" onClick={onEdit}>
          Edit bot
        </Button>
      </header>
      {!project && (
        <InlineNotice tone="warning">
          This bot’s project is no longer in Jackalope. Edit the bot to choose another project.
        </InlineNotice>
      )}
      <form
        className="bots-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Textarea
          aria-label={`Message ${bot.name}`}
          placeholder={`Message ${bot.name}…`}
          rows={3}
          maxLength={12000}
          value={text}
          disabled={!project}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
        <div className="bots-composer-actions">
          <span className="task-muted">Starts a new conversation in Work.</span>
          <Button
            type="submit"
            disabled={!text.trim() || !project || !isTauriEnvironment()}
            loading={busy}
            loadingLabel="Starting…"
          >
            Send
          </Button>
        </div>
      </form>
      <section className="workspace-section workspace-stack">
        <WorkspaceSectionHeading title="Instructions" />
        <p className="bots-instructions">
          {bot.instructions || 'No standing instructions. Edit the bot to add some.'}
        </p>
      </section>
      <section className="workspace-section workspace-stack">
        <WorkspaceSectionHeading title="Conversations" />
        {conversations.length ? (
          <ul className="bots-list">
            {conversations.slice(0, 12).map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  className="bots-list-row"
                  onClick={() => openConversation(session)}
                >
                  <MessageSquare size={16} aria-hidden="true" />
                  <span>{session.title}</span>
                  <small>
                    {session.closed ? 'Finished · ' : ''}
                    {new Date(session.updatedAt).toLocaleString()}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="task-muted">Send a message to start the first conversation.</p>
        )}
      </section>
      {project && <BotRoutines bot={bot} project={project} />}
    </section>
  );
}

function BotRoutines({ bot, project }: { bot: Bot; project: Project }) {
  const [ledger, setLedger] = useState<ScheduleLedger | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const template = BOT_TEMPLATES.find((item) => item.name === bot.name)?.routine;
  const [name, setName] = useState(template?.name ?? '');
  const [task, setTask] = useState(template?.prompt ?? '');
  const [repeat, setRepeat] = useState('weekdays');
  const [time, setTime] = useState('09:00');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const read = useCallback(async () => {
    if (!isTauriEnvironment()) return;
    try {
      setLedger(await nativeTask<ScheduleLedger>('schedule_list'));
    } catch (cause) {
      setError(String(cause));
    }
  }, []);
  useEffect(() => {
    void read();
  }, [read]);
  const routines =
    ledger?.schedules.filter((schedule) => bot.routineIds.includes(schedule.definition.id)) ?? [];
  // Routines removed in Automations are dropped from the bot once the ledger confirms it.
  useEffect(() => {
    if (!ledger) return;
    for (const id of bot.routineIds)
      if (!ledger.schedules.some((schedule) => schedule.definition.id === id))
        useBotStore.getState().forgetRoutine(id);
  }, [ledger, bot.routineIds]);
  const save = async () => {
    const expression = scheduleTimingExpression(repeat, time, '1');
    if (!name.trim() || !task.trim() || !expression) {
      setError('Name the routine, describe the work and choose a valid time.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await syncAgentConfig();
      const id = crypto.randomUUID();
      const prompt = routinePrompt(bot, task);
      await nativeTask('schedule_save', {
        definition: {
          id,
          name: `${bot.name}: ${name.trim()}`.slice(0, 160),
          expression,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          rawPrompt: prompt,
          missed: 'skip',
          enabled,
          request: { ...botRequest(bot, project, id, prompt), autoVerify: false },
        },
      });
      useBotStore.getState().addRoutine(bot.id, id);
      setAdding(false);
      setName('');
      setTask('');
      await read();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="workspace-section workspace-stack">
      <WorkspaceSectionHeading
        title="Routines"
        description="Scheduled work this bot runs on its own. Manage timing and history in Automations."
        action={
          !adding && (
            <Button variant="outline" onClick={() => setAdding(true)}>
              <CalendarClock size={16} aria-hidden="true" />
              Add routine
            </Button>
          )
        }
      />
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {routines.length > 0 && (
        <ul className="bots-list">
          {routines.map((routine) => (
            <li key={routine.definition.id} className="bots-routine">
              <span>
                <strong>{routine.definition.name.replace(`${bot.name}: `, '')}</strong>
                <small>
                  {routine.definition.enabled
                    ? `Next run ${new Date(routine.nextAt).toLocaleString()}`
                    : 'Paused'}
                </small>
              </span>
              <Switch
                aria-label={`Run ${routine.definition.name}`}
                checked={routine.definition.enabled}
                onCheckedChange={async (next) => {
                  try {
                    await nativeTask('schedule_set_enabled', {
                      id: routine.definition.id,
                      enabled: next,
                    });
                    await read();
                  } catch (cause) {
                    setError(String(cause));
                  }
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {!routines.length && !adding && <p className="task-muted">No routines yet.</p>}
      {adding && (
        <form
          className="bots-routine-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <FormField label="Routine name">
            <Input
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              placeholder="Weekly dependency check"
            />
          </FormField>
          <FormField label="What should it do?">
            <Textarea rows={3} value={task} onChange={(event) => setTask(event.target.value)} />
          </FormField>
          <div className="bots-routine-timing">
            <FormField label="Repeat">
              <Select value={repeat} onValueChange={setRepeat}>
                <SelectItem value="daily">Every day</SelectItem>
                <SelectItem value="weekdays">Weekdays</SelectItem>
                <SelectItem value="weekly">Every Monday</SelectItem>
              </Select>
            </FormField>
            <FormField label="Time">
              <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            </FormField>
            <label className="bots-switch">
              <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Turn on now" />
              Turn on now
            </label>
          </div>
          <div className="bots-composer-actions">
            <Button variant="ghost" type="button" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} loadingLabel="Saving…">
              Save routine
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
