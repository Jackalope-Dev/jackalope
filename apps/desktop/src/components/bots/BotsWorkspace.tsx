import { ConfirmDialog, DropdownMenu as Menu, SearchField, Switch, Textarea } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AlarmClock,
  ArrowRightLeft,
  Bot as BotIcon,
  MessageSquare,
  MoreHorizontal,
  Pin,
  Plus,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  botActivity,
  botConversations,
  continuableConversation,
  isUnread,
  lastReplyAt,
} from '../../lib/bot-conversations';
import {
  type BotNote,
  type BotProposal,
  botRequest,
  describeWake,
  forgetNote,
  type HubEvent,
  needsYou,
  resolveProposal,
  setWakeUpsPaused,
  useBotHubStore,
  type WakeState,
  wakeNow,
} from '../../lib/bot-hub';
import { BOT_TEMPLATES, type BotTemplate } from '../../lib/bot-templates';
import { type LiveSession, type SessionDraft, sessionCommand } from '../../lib/live-session';
import type { TaskRun } from '../../lib/task-runtime';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import {
  BOT_STYLES,
  type Bot,
  type BotDraft,
  type BotWake,
  rosterOrder,
  useBotStore,
} from '../../stores/botStore';
import { observeLiveSessions, useLiveSessionStore } from '../../stores/liveSessionStore';
import { agentAccountFor, type Project, useProjectStore } from '../../stores/projectStore';
import { LiveSessionView } from '../sessions/LiveSessionView';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';
import { InlineNotice } from '../ui/InlineNotice';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import { BotAvatar } from './BotAvatar';
import { BotCardView } from './BotCardView';
import { BotEditor } from './BotEditor';
import './bots.css';

interface ScheduleLedger {
  schedules: {
    definition: { id: string; name: string; enabled: boolean; expression: string };
    nextAt: string;
  }[];
}

function randomStyle() {
  return BOT_STYLES[Math.floor(Math.random() * BOT_STYLES.length)].id;
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
    appearance: template?.appearance ?? { style: randomStyle(), color: 'accent' },
    collaborate: true,
    // A template's suggested schedule starts off: templates never start work by themselves.
    wakes: template?.routine
      ? [
          {
            id: crypto.randomUUID(),
            name: template.routine.name,
            prompt: template.routine.prompt,
            enabled: false,
            trigger: {
              kind: 'schedule',
              expression: template.routine.expression,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
          },
        ]
      : [],
  };
}

function proposalDraft(proposal: BotProposal, projectId: string): BotDraft {
  return {
    ...blankDraft(projectId),
    name: proposal.name,
    role: proposal.role,
    instructions: proposal.instructions,
    wakes: proposal.wake
      ? [
          {
            id: crypto.randomUUID(),
            name: proposal.wake.name,
            prompt: proposal.wake.prompt,
            enabled: true,
            trigger: {
              kind: 'schedule',
              expression: proposal.wake.expression,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
          },
        ]
      : [],
  };
}

function profileFor(bot: Bot, project: Project) {
  const adapter =
    useAgentConfigStore.getState().customAgents.find((agent) => agent.id === bot.agent)?.adapter ??
    bot.agent;
  return agentAccountFor(project, adapter);
}

/** How a conversation started when the person did not start it. */
function conversationOrigin(session: LiveSession) {
  const origin = session.messages[0]?.origin;
  if (!origin) return '';
  if (origin.kind === 'wake') return 'Woke up';
  if (origin.kind === 'card') return 'Your answer';
  return origin.label;
}

export function BotsWorkspace() {
  const { bots, selectedId, openId, seen, seenFloor } = useBotStore(
    useShallow((state) => ({
      bots: state.bots,
      selectedId: state.selectedId,
      openId: state.openSessionId,
      seen: state.seen,
      seenFloor: state.seenFloor,
    })),
  );
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const sessions = useLiveSessionStore((state) => state.sessions);
  const sessionRuns = useLiveSessionStore((state) => state.runs);
  const hub = useBotHubStore(
    useShallow((state) => ({
      cards: state.cards,
      proposals: state.proposals,
      events: state.events,
      notes: state.notes,
      wakes: state.wakes,
      paused: state.paused,
      error: state.error,
    })),
  );
  const [pickingTemplate, setPickingTemplate] = useState(false);
  const open = sessions.find((session) => session.id === openId && session.persona);
  useEffect(observeLiveSessions, []);
  // Reading a conversation, including replies that arrive while it is open, marks it read.
  const openSessionId = open?.id;
  const openReply = open ? lastReplyAt(open, sessionRuns) : null;
  useEffect(() => {
    if (openSessionId && openReply !== undefined) useBotStore.getState().markSeen(openSessionId);
  }, [openSessionId, openReply]);
  const [editing, setEditing] = useState<{
    bot?: Bot;
    draft: BotDraft;
    proposalId?: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<Bot | null>(null);
  const roster = useMemo(() => rosterOrder(bots), [bots]);
  const selected = bots.find((bot) => bot.id === selectedId) ?? roster[0];
  const defaultProject = activeProjectId ?? projects[0]?.id ?? '';
  useEffect(() => {
    if (isTauriEnvironment()) void useLiveSessionStore.getState().refresh(null);
  }, []);
  const conversationsFor = useCallback(
    (bot: Bot) => botConversations(sessions, bot.id),
    [sessions],
  );
  // Opening another bot's conversation, such as one a message came from, selects that bot too.
  const openSession = useCallback(
    (id: string) => {
      const botId = sessions.find((session) => session.id === id)?.persona?.botId;
      useBotStore.getState().openConversation(id, botId);
    },
    [sessions],
  );
  const startNew = (template?: BotTemplate) =>
    setEditing({ draft: blankDraft(defaultProject, template) });
  return (
    <WorkspacePage className="bots-page">
      <WorkspaceHeading
        title="Bots"
        action={
          <div className="bots-heading-actions">
            {bots.length > 0 && <HubMenu paused={hub.paused} />}
            <Button onClick={() => startNew()} disabled={!projects.length}>
              <Plus size={16} aria-hidden="true" />
              Create a new bot
            </Button>
          </div>
        }
      />
      {hub.paused && bots.length > 0 && (
        <InlineNotice
          tone="warning"
          action={
            <Button variant="outline" onClick={() => void setWakeUpsPaused(false)}>
              Resume wake-ups
            </Button>
          }
        >
          Wake-ups are paused. Bots only work when you message them or use Run now.
        </InlineNotice>
      )}
      {!projects.length && (
        <InlineNotice>Add a project first. Each bot works inside one project.</InlineNotice>
      )}
      {hub.error && <InlineNotice tone="error">{hub.error}</InlineNotice>}
      {bots.length === 0 ? (
        <BotTemplates disabled={!projects.length} onUse={(template) => startNew(template)} />
      ) : (
        <div className="bots-layout">
          <nav className="bots-roster" aria-label="Bots">
            {roster.map((bot) => {
              const conversations = conversationsFor(bot);
              const latest = conversations[0];
              const waiting = needsYou(hub, bot.id).count;
              const unread = conversations.filter((session) =>
                isUnread(session, sessionRuns, seen, seenFloor),
              ).length;
              const activity = botActivity(conversations, sessionRuns);
              const label = [
                bot.name,
                activity === 'working'
                  ? 'working'
                  : activity === 'waiting'
                    ? 'needs an answer'
                    : '',
                unread ? `${unread} new ${unread === 1 ? 'reply' : 'replies'}` : '',
                waiting ? `${waiting} waiting on you` : '',
              ]
                .filter(Boolean)
                .join(', ');
              return (
                <div
                  key={bot.id}
                  className="bots-roster-item"
                  data-selected={bot.id === selected?.id || undefined}
                  data-unread={unread > 0 || undefined}
                >
                  <button
                    type="button"
                    className="bots-roster-open"
                    aria-current={bot.id === selected?.id ? 'true' : undefined}
                    aria-label={label === bot.name ? undefined : label}
                    onClick={() => useBotStore.getState().openConversation(null, bot.id)}
                  >
                    <BotAvatar appearance={bot.appearance} agent={bot.agent} state={activity} />
                    <span className="bots-roster-copy">
                      <strong>
                        {bot.name}
                        {bot.pinned && <Pin size={12} aria-label="Pinned" />}
                      </strong>
                      <small>{latest?.title ?? (bot.role || 'No conversations yet')}</small>
                    </span>
                    {waiting > 0 ? (
                      <small className="bots-roster-count" aria-hidden="true">
                        {waiting}
                      </small>
                    ) : (
                      unread > 0 && <span className="bots-roster-unread" aria-hidden="true" />
                    )}
                  </button>
                  <BotMenu
                    bot={bot}
                    onEdit={() => setEditing({ bot, draft: bot })}
                    onDelete={() => setDeleting(bot)}
                  />
                </div>
              );
            })}
            <button
              type="button"
              className="bots-roster-template"
              disabled={!projects.length}
              onClick={() => setPickingTemplate(true)}
            >
              Create from template
            </button>
          </nav>
          {open ? (
            <div className="bots-conversation">
              <LiveSessionView
                key={open.id}
                session={open}
                runs={sessionRuns}
                initialDetailsOpen={false}
                onBack={() => useBotStore.getState().openConversation(null)}
                onOpenSession={openSession}
                simple
              />
            </div>
          ) : (
            selected && (
              <BotProfile
                key={selected.id}
                bot={selected}
                bots={bots}
                project={projects.find((project) => project.id === selected.projectId)}
                conversations={conversationsFor(selected)}
                runs={sessionRuns}
                isUnread={(session) => isUnread(session, sessionRuns, seen, seenFloor)}
                notes={hub.notes.filter((note) => note.botId === selected.id)}
                proposals={hub.proposals.filter(
                  (item) => item.status === 'open' && item.fromBotId === selected.id,
                )}
                events={hub.events.filter(
                  (event) => event.botId === selected.id || event.otherBotId === selected.id,
                )}
                wakeStates={hub.wakes}
                onEdit={() => setEditing({ bot: selected, draft: selected })}
                onOpen={openSession}
                onReviewProposal={(proposal) =>
                  setEditing({
                    draft: proposalDraft(proposal, selected.projectId),
                    proposalId: proposal.id,
                  })
                }
              />
            )
          )}
        </div>
      )}
      {pickingTemplate && (
        <Dialog.Root open onOpenChange={(value) => !value && setPickingTemplate(false)}>
          <DialogContent className="bots-template-dialog">
            <DialogHeader title="Create from template" />
            <DialogCloseButton />
            <BotTemplates
              disabled={!projects.length}
              heading={false}
              onUse={(template) => {
                setPickingTemplate(false);
                startNew(template);
              }}
            />
          </DialogContent>
        </Dialog.Root>
      )}
      {editing && (
        <BotEditor
          bot={editing.bot}
          initial={editing.draft}
          onClose={() => setEditing(null)}
          onSave={(draft) => {
            const store = useBotStore.getState();
            if (editing.bot) store.update(editing.bot.id, draft);
            else {
              const id = store.create(draft);
              if (editing.proposalId) void resolveProposal(editing.proposalId, 'accept', id);
            }
            setEditing(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={`Delete ${deleting.name}?`}
          description="Its conversations and routines stay. Its wake-ups stop, and other bots can no longer message it."
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
  heading = true,
}: {
  disabled: boolean;
  onUse: (template: BotTemplate) => void;
  heading?: boolean;
}) {
  return (
    <section className="workspace-section workspace-stack">
      {heading && <WorkspaceSectionHeading title="Start from a template" />}
      <ul className="bots-templates">
        {BOT_TEMPLATES.map((template) => (
          <li key={template.id} className="bots-template">
            <BotAvatar appearance={template.appearance} />
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
    </section>
  );
}

function HubMenu({ paused }: { paused: boolean }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="outline" aria-label="Bot options">
          <MoreHorizontal size={16} aria-hidden="true" />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="workspace-menu" align="end" sideOffset={6}>
          <Menu.Item
            className="workspace-menu-item"
            onSelect={() => void setWakeUpsPaused(!paused)}
          >
            {paused ? 'Resume all wake-ups' : 'Pause all wake-ups'}
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
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

/** Rows listed before Show all; longer conversation lists also get search. */
const LIST_LIMIT = 12;

/** The first readable line of the latest reply, for list previews. */
function replyPreview(session: LiveSession, runs: TaskRun[]) {
  const id = session.batches.at(-1)?.runId;
  const result = runs.find((run) => run.id === id)?.result ?? '';
  const line =
    result
      .split('\n')
      .map((item) => item.replace(/^[\s#>*`|-]+/, '').trim())
      .find(Boolean) ?? '';
  return [...line].length > 140 ? `${[...line].slice(0, 139).join('')}…` : line;
}

function BotProfile({
  bot,
  bots,
  project,
  conversations,
  runs,
  isUnread,
  notes,
  proposals,
  events,
  wakeStates,
  onEdit,
  onOpen,
  onReviewProposal,
}: {
  bot: Bot;
  bots: Bot[];
  project?: Project;
  conversations: LiveSession[];
  runs: TaskRun[];
  isUnread: (session: LiveSession) => boolean;
  notes: BotNote[];
  proposals: BotProposal[];
  events: HubEvent[];
  wakeStates: WakeState[];
  onEdit: () => void;
  onOpen: (id: string) => void;
  onReviewProposal: (proposal: BotProposal) => void;
}) {
  const cards = useBotHubStore(useShallow((state) => needsYou(state, bot.id).cards));
  const draftKey = `jackalope-bot-draft:${bot.id}`;
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(draftKey) ?? '';
    } catch {
      return '';
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fresh, setFresh] = useState(false);
  const [allEvents, setAllEvents] = useState(false);
  const latestOpen = continuableConversation(conversations);
  const continuing = fresh ? undefined : latestOpen;
  const pending = useRef<{
    id: string;
    messageId: string;
    text: string;
    continues: boolean;
  } | null>(null);
  useEffect(() => {
    try {
      if (text) localStorage.setItem(draftKey, text);
      else localStorage.removeItem(draftKey);
    } catch {}
  }, [draftKey, text]);
  const send = async () => {
    const value = text.trim();
    if (!value || !project || busy) return;
    if ([...value].length > 12000) {
      setError('Shorten this message to 12,000 characters. Your draft is preserved.');
      return;
    }
    // Retrying the same text to the same place reuses identifiers so a slow first attempt
    // cannot duplicate it.
    const target = continuing?.id;
    const previous = pending.current;
    if (
      !previous ||
      previous.text !== value ||
      previous.continues !== !!target ||
      (target && previous.id !== target)
    )
      pending.current = {
        id: target ?? crypto.randomUUID(),
        messageId: crypto.randomUUID(),
        text: value,
        continues: !!target,
      };
    const attempt = pending.current;
    if (!attempt) return;
    setBusy(true);
    setError('');
    try {
      if (attempt.continues)
        await sessionCommand<SessionDraft>('send', {
          id: attempt.id,
          messageId: attempt.messageId,
          text: value,
        });
      else {
        await syncAgentConfig();
        await sessionCommand('create', {
          id: attempt.id,
          request: botRequest(bot, project, attempt.id, value, true, profileFor(bot, project)),
          firstMessage: { id: attempt.messageId, text: value },
          limits: { maxBatches: null, pauseAtEstimatedUsd: null },
          persona: { botId: bot.id, name: bot.name, instructions: bot.instructions },
        });
      }
      setText('');
      setFresh(false);
      pending.current = null;
      await useLiveSessionStore.getState().refresh(attempt.id);
      onOpen(attempt.id);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const nameOf = (id: string | null) => bots.find((item) => item.id === id)?.name;
  return (
    <section className="bots-profile" aria-label={bot.name}>
      <header className="bots-profile-header">
        <BotAvatar
          appearance={bot.appearance}
          agent={bot.agent}
          size="lg"
          state={botActivity(conversations, runs)}
        />
        <div className="bots-profile-identity">
          <h2>{bot.name}</h2>
          {bot.role && <p>{bot.role}</p>}
        </div>
      </header>
      {!project && (
        <InlineNotice
          tone="warning"
          action={
            <Button variant="outline" onClick={onEdit}>
              Edit bot
            </Button>
          }
        >
          This bot’s project is no longer in Jackalope. Edit the bot to choose another project. Its
          wake-ups are paused until then.
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
          aria-describedby={`bot-thread-${bot.id}`}
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
          <span className="bots-composer-thread" id={`bot-thread-${bot.id}`}>
            {continuing ? (
              <>
                Continues <strong>{continuing.title}</strong>
              </>
            ) : (
              'Starts a new conversation'
            )}
          </span>
          {continuing ? (
            <Button type="button" variant="ghost" onClick={() => setFresh(true)}>
              New conversation
            </Button>
          ) : (
            latestOpen && (
              <Button type="button" variant="ghost" onClick={() => setFresh(false)}>
                Continue latest
              </Button>
            )
          )}
          <Button
            type="submit"
            disabled={!text.trim() || !project || !isTauriEnvironment()}
            loading={busy}
            loadingLabel="Sending…"
          >
            Send
          </Button>
        </div>
      </form>
      {(cards.length > 0 || proposals.length > 0) && (
        <section className="workspace-section workspace-stack">
          <WorkspaceSectionHeading title="Needs you" />
          <div className="bots-cards">
            {cards.map((card) => (
              <BotCardView key={card.id} card={card} onOpenConversation={onOpen} />
            ))}
            {proposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                onReview={() => onReviewProposal(proposal)}
                onOpen={() => onOpen(proposal.sessionId)}
              />
            ))}
          </div>
        </section>
      )}
      <ConversationList
        conversations={conversations}
        runs={runs}
        isUnread={isUnread}
        onOpen={onOpen}
      />
      <BotMemory bot={bot} notes={notes} onOpen={onOpen} />
      <BotWakeList
        bot={bot}
        project={project}
        states={wakeStates}
        onEdit={onEdit}
        onOpen={onOpen}
      />
      {events.length > 0 && (
        <section className="workspace-section workspace-stack">
          <WorkspaceSectionHeading
            title="Activity"
            description={
              bot.collaborate
                ? 'Wake-ups, messages with other bots and cards.'
                : 'Wake-ups and cards. Messaging other bots is off.'
            }
          />
          <ul className="bots-list bots-activity">
            {events
              .slice(allEvents ? 0 : -LIST_LIMIT)
              .reverse()
              .map((event) => (
                <li key={event.id}>
                  <ActivityRow
                    event={event}
                    other={nameOf(event.botId === bot.id ? event.otherBotId : event.botId)}
                    onOpen={onOpen}
                  />
                </li>
              ))}
          </ul>
          {events.length > LIST_LIMIT && (
            <Button variant="ghost" onClick={() => setAllEvents(!allEvents)}>
              {allEvents ? 'Show recent' : `Show all ${events.length}`}
            </Button>
          )}
        </section>
      )}
      {project && bot.routineIds.length > 0 && <BotRoutines bot={bot} />}
    </section>
  );
}

function ConversationList({
  conversations,
  runs,
  isUnread,
  onOpen,
}: {
  conversations: LiveSession[];
  runs: TaskRun[];
  isUnread: (session: LiveSession) => boolean;
  onOpen: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState('');
  const search = query.trim().toLowerCase();
  const matching = search
    ? conversations.filter((session) =>
        [session.title, ...session.messages.map((message) => message.text)].some((text) =>
          text.toLowerCase().includes(search),
        ),
      )
    : conversations;
  const shown = all || search ? matching : matching.slice(0, LIST_LIMIT);
  return (
    <section className="workspace-section workspace-stack">
      <WorkspaceSectionHeading title="Conversations" />
      {conversations.length > LIST_LIMIT && (
        <SearchField
          aria-label="Search conversations"
          placeholder="Search conversations…"
          maxLength={200}
          value={query}
          onValueChange={setQuery}
        />
      )}
      {shown.length ? (
        <ul className="bots-list">
          {shown.map((session) => {
            const origin = conversationOrigin(session);
            const unread = isUnread(session);
            const preview = replyPreview(session, runs);
            return (
              <li key={session.id}>
                <button
                  type="button"
                  className="bots-list-row bots-conversation-row"
                  data-unread={unread || undefined}
                  onClick={() => onOpen(session.id)}
                >
                  {origin === 'Woke up' ? (
                    <AlarmClock size={16} aria-hidden="true" />
                  ) : origin ? (
                    <ArrowRightLeft size={16} aria-hidden="true" />
                  ) : (
                    <MessageSquare size={16} aria-hidden="true" />
                  )}
                  <span className="bots-conversation-copy">
                    <span className="bots-conversation-title">
                      {session.title}
                      {unread && <span className="sr-only">, new reply</span>}
                    </span>
                    {preview && <small className="bots-conversation-preview">{preview}</small>}
                  </span>
                  <small>
                    {origin ? `${origin} · ` : ''}
                    {session.closed ? 'Finished · ' : session.paused ? 'Paused · ' : ''}
                    {new Date(session.updatedAt).toLocaleString()}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="task-muted">
          {search ? 'No conversations match.' : 'Send a message to start the first conversation.'}
        </p>
      )}
      {!search && conversations.length > LIST_LIMIT && (
        <Button variant="ghost" onClick={() => setAll(!all)}>
          {all ? 'Show recent' : `Show all ${conversations.length}`}
        </Button>
      )}
    </section>
  );
}

/** Notes the bot saved for its future conversations; the person can remove any of them. */
function BotMemory({
  bot,
  notes,
  onOpen,
}: {
  bot: Bot;
  notes: BotNote[];
  onOpen: (id: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  return (
    <section className="workspace-section workspace-stack">
      <WorkspaceSectionHeading
        title="Memory"
        description={`What ${bot.name} brings to new conversations, with how its latest ones ended.`}
      />
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {notes.length ? (
        <ul className="bots-list">
          {notes.map((note) => (
            <li key={note.id} className="bots-routine">
              <span>
                <span className="bots-note">{note.text}</span>
                <small>{new Date(note.updatedAt).toLocaleString()}</small>
              </span>
              <span className="bot-wake-actions">
                {note.sessionId && (
                  <Button variant="ghost" onClick={() => onOpen(note.sessionId ?? '')}>
                    Source
                  </Button>
                )}
                <Button
                  variant="ghost"
                  aria-label={`Remove note: ${note.text.slice(0, 60)}`}
                  loading={busy === note.id}
                  loadingLabel="Removing…"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy(note.id);
                    setError('');
                    try {
                      await forgetNote(note.id);
                    } catch (cause) {
                      setError(String(cause));
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="task-muted">
          Nothing saved yet. {bot.name} saves preferences, decisions and progress here as it works.
        </p>
      )}
    </section>
  );
}

function ProposalCard({
  proposal,
  onReview,
  onOpen,
}: {
  proposal: BotProposal;
  onReview: () => void;
  onOpen: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <article className="bot-card" data-kind="proposal">
      <header className="bot-card-header">
        <Sparkles size={16} aria-hidden="true" />
        <span>
          <small>Suggested bot</small>
          <strong>
            {proposal.name} · {proposal.role}
          </strong>
        </span>
      </header>
      <p className="bot-card-body">{proposal.reason}</p>
      {proposal.wake && (
        <p className="bot-card-body task-muted">
          Wakes up:{' '}
          {describeWake({
            id: '',
            name: proposal.wake.name,
            prompt: proposal.wake.prompt,
            enabled: true,
            trigger: { kind: 'schedule', expression: proposal.wake.expression, timezone: '' },
          })}{' '}
          · {proposal.wake.name}
        </p>
      )}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <footer className="bot-card-footer">
        <Button variant="ghost" onClick={onOpen}>
          Open conversation
        </Button>
        <Button
          variant="ghost"
          loading={busy}
          loadingLabel="Dismissing…"
          onClick={async () => {
            setBusy(true);
            try {
              await resolveProposal(proposal.id, 'dismiss');
            } catch (cause) {
              setError(String(cause));
            } finally {
              setBusy(false);
            }
          }}
        >
          Dismiss
        </Button>
        <Button onClick={onReview}>
          <BotIcon size={16} aria-hidden="true" />
          Review and create
        </Button>
      </footer>
    </article>
  );
}

function ActivityRow({
  event,
  other,
  onOpen,
}: {
  event: HubEvent;
  other?: string;
  onOpen: (id: string) => void;
}) {
  const content = (
    <>
      {event.kind === 'wake' || event.kind === 'skipped' ? (
        <AlarmClock size={16} aria-hidden="true" />
      ) : event.kind === 'message' || event.kind === 'reply' ? (
        <ArrowRightLeft size={16} aria-hidden="true" />
      ) : (
        <Sparkles size={16} aria-hidden="true" />
      )}
      <span>
        {event.text}
        {other && event.kind === 'reply' ? ` to ${other}` : ''}
      </span>
      <small>{new Date(event.at).toLocaleString()}</small>
    </>
  );
  return event.sessionId ? (
    <button type="button" className="bots-list-row" onClick={() => onOpen(event.sessionId ?? '')}>
      {content}
    </button>
  ) : (
    <div className="bots-list-row" data-static>
      {content}
    </div>
  );
}

function BotWakeList({
  bot,
  project,
  states,
  onEdit,
  onOpen,
}: {
  bot: Bot;
  project?: Project;
  states: WakeState[];
  onEdit: () => void;
  onOpen: (id: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const setWake = (id: string, patch: Partial<BotWake>) => {
    try {
      useBotStore.getState().update(bot.id, {
        wakes: bot.wakes.map((wake) => (wake.id === id ? { ...wake, ...patch } : wake)),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <section className="workspace-section workspace-stack">
      <WorkspaceSectionHeading
        title="Wake-ups"
        description="Wake-ups start or continue conversations on their own."
        action={
          <Button variant="outline" onClick={onEdit}>
            <AlarmClock size={16} aria-hidden="true" />
            {bot.wakes.length ? 'Edit wake-ups' : 'Add wake-up'}
          </Button>
        }
      />
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {bot.wakes.length ? (
        <ul className="bots-list">
          {bot.wakes.map((wake) => {
            const state = states.find((item) => item.wakeId === wake.id);
            const status = !wake.enabled
              ? 'Off'
              : [
                  state?.lastOutcome,
                  wake.trigger.kind === 'schedule' && state?.nextCheckAt
                    ? `Next ${new Date(state.nextCheckAt).toLocaleString()}`
                    : state?.lastCheckedAt
                      ? `Checked ${new Date(state.lastCheckedAt).toLocaleTimeString()}`
                      : 'Starting',
                ]
                  .filter(Boolean)
                  .join(' · ');
            return (
              <li key={wake.id} className="bots-routine">
                <span>
                  <strong>{wake.name}</strong>
                  <small>{describeWake(wake)}</small>
                  <small>{status}</small>
                </span>
                <span className="bot-wake-actions">
                  {state?.lastSessionId && (
                    <Button variant="ghost" onClick={() => onOpen(state.lastSessionId ?? '')}>
                      Latest
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    disabled={!project || !isTauriEnvironment() || busy !== null}
                    loading={busy === wake.id}
                    loadingLabel="Waking…"
                    onClick={async () => {
                      setBusy(wake.id);
                      setError('');
                      try {
                        onOpen(await wakeNow(bot.id, wake.id));
                        await useLiveSessionStore.getState().refresh(null);
                      } catch (cause) {
                        setError(String(cause));
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    Run now
                  </Button>
                  <Switch
                    aria-label={`Turn on ${wake.name}`}
                    checked={wake.enabled}
                    onCheckedChange={(enabled) => setWake(wake.id, { enabled })}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="task-muted">
          Wake {bot.name} on a schedule, when the project changes or when a connection has new data.
        </p>
      )}
    </section>
  );
}

/** Schedules created as routines before wake-ups existed. Timing and history stay in Automations. */
function BotRoutines({ bot }: { bot: Bot }) {
  const [ledger, setLedger] = useState<ScheduleLedger | null>(null);
  const [error, setError] = useState('');
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
  if (!routines.length && !error) return null;
  return (
    <section className="workspace-section workspace-stack">
      <WorkspaceSectionHeading
        title="Routines"
        description="Earlier scheduled tasks. Manage timing and history in Automations."
      />
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
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
    </section>
  );
}
