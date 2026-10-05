import { ConfirmDialog, DropdownMenu as Menu, Switch, Textarea } from '@jackalope/ui';
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
  type BotProposal,
  botRequest,
  describeWake,
  type HubEvent,
  needsYou,
  resolveProposal,
  setWakeUpsPaused,
  useBotHubStore,
  type WakeState,
  wakeNow,
} from '../../lib/bot-hub';
import { BOT_TEMPLATES, type BotTemplate } from '../../lib/bot-templates';
import { type LiveSession, sessionCommand } from '../../lib/live-session';
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
  const { bots, selectedId } = useBotStore(
    useShallow((state) => ({ bots: state.bots, selectedId: state.selectedId })),
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
      wakes: state.wakes,
      paused: state.paused,
      error: state.error,
    })),
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [pickingTemplate, setPickingTemplate] = useState(false);
  const open = sessions.find((session) => session.id === openId && session.persona);
  useEffect(observeLiveSessions, []);
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
    (bot: Bot) =>
      sessions
        .filter((session) => session.persona?.botId === bot.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [sessions],
  );
  // Opening another bot's conversation, such as one a message came from, selects that bot too.
  const openSession = useCallback(
    (id: string) => {
      const botId = sessions.find((session) => session.id === id)?.persona?.botId;
      if (botId) useBotStore.getState().select(botId);
      setOpenId(id);
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
              const latest = conversationsFor(bot)[0];
              const waiting = needsYou(hub, bot.id).count;
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
                    aria-label={waiting ? `${bot.name}, ${waiting} waiting on you` : undefined}
                    onClick={() => {
                      useBotStore.getState().select(bot.id);
                      setOpenId(null);
                    }}
                  >
                    <BotAvatar appearance={bot.appearance} agent={bot.agent} />
                    <span className="bots-roster-copy">
                      <strong>
                        {bot.name}
                        {bot.pinned && <Pin size={12} aria-label="Pinned" />}
                      </strong>
                      <small>{latest?.title ?? (bot.role || 'No conversations yet')}</small>
                    </span>
                    {waiting > 0 && (
                      <small className="bots-roster-count" aria-hidden="true">
                        {waiting}
                      </small>
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
                onBack={() => setOpenId(null)}
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

function BotProfile({
  bot,
  bots,
  project,
  conversations,
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
  proposals: BotProposal[];
  events: HubEvent[];
  wakeStates: WakeState[];
  onEdit: () => void;
  onOpen: (id: string) => void;
  onReviewProposal: (proposal: BotProposal) => void;
}) {
  const cards = useBotHubStore(useShallow((state) => needsYou(state, bot.id).cards));
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
    if ([...value].length > 12000) {
      setError('Shorten this message to 12,000 characters. Your draft is preserved.');
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
        request: botRequest(bot, project, attempt.id, value, true, profileFor(bot, project)),
        firstMessage: { id: attempt.messageId, text: value },
        limits: { maxBatches: null, pauseAtEstimatedUsd: null },
        persona: { botId: bot.id, name: bot.name, instructions: bot.instructions },
      });
      setText('');
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
        <BotAvatar appearance={bot.appearance} agent={bot.agent} size="lg" />
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
      <section className="workspace-section workspace-stack">
        <WorkspaceSectionHeading title="Conversations" />
        {conversations.length ? (
          <ul className="bots-list">
            {conversations.slice(0, 12).map((session) => {
              const origin = conversationOrigin(session);
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    className="bots-list-row"
                    onClick={() => onOpen(session.id)}
                  >
                    {origin === 'Woke up' ? (
                      <AlarmClock size={16} aria-hidden="true" />
                    ) : origin ? (
                      <ArrowRightLeft size={16} aria-hidden="true" />
                    ) : (
                      <MessageSquare size={16} aria-hidden="true" />
                    )}
                    <span>{session.title}</span>
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
          <p className="task-muted">Send a message to start the first conversation.</p>
        )}
      </section>
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
              .slice(-12)
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
        </section>
      )}
      {project && bot.routineIds.length > 0 && <BotRoutines bot={bot} />}
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
