# Bots

Bots are saved agent profiles that can work on their own. Use this guide when changing
bot storage, persona delivery, wake-ups, messages between bots or cards. See
[UI guidelines](UI-GUIDELINES.md) for the workspace and [core workflow](CORE-WORKFLOW.md)
for the chat sessions bots start.

## Profiles

`stores/botStore.ts` keeps bots in renderer storage: name, role, standing instructions,
agent (`auto` or an agent ID), optional model, project, connection scope, wake-ups,
whether the bot works with other bots (`collaborate`) and the schedule IDs of routines
created before wake-ups existed. A `null` connection scope delivers every enabled
connection; a list becomes the run request's `connectionIds`. Edits apply to new
conversations only. Instructions are limited to 6,000 characters in the renderer and
in native validation. Version 2 of the store adds empty wake-ups and `collaborate: true`
to older saved bots; duplicates copy wake-ups turned off.

An optional `appearance` holds a character style (the shared `AgentCharacter`
silhouettes plus bot-only shapes whose face stays inside the fill) and a colour from
`BOT_COLORS`, applied through the `--agent-color` variable. Bots saved without one
draw their agent's character in the text colour; the retired crescent maps to Moon.
`BotAvatar` is the only way bots are drawn, including in their conversations.

Templates in `lib/bot-templates.ts` prefill the editor with a role, instructions, an
appearance and, where useful, a scheduled wake-up that starts turned off. They never
grant access, enable connections or start work. Creating a bot walks through five short
steps; editing shows the same sections on one page.

## Native hub

The renderer mirrors bots whose project still exists into `commands/bot_hub.rs` through
`bot_hub_sync`, after both the bot and project stores hydrate so an empty early
directory cannot clear wake-up progress. Each entry carries the conversation run
request the Bots page would start with. The hub stores its directory, wake-up state,
cards, suggestions, hand-offs and the latest 300 activity entries in
`bots/hub.json` in the profile directory, written atomically. An unreadable file is
preserved and every write is refused until it is repaired. `bot-hub-changed` events
and a 15-second poll keep the renderer snapshot current.

Everything the hub starts is an ordinary persona live session. Messages the person did
not type carry an `origin` (`wake`, `bot`, `reply` or `card`) that the transcript shows
and the batch prompt labels; renderer requests cannot set it. Conversations the hub
starts pause after 20 batches until the person resumes them.

## Wake-ups

A wake-up has a name, what to do, an on/off switch and one trigger:

- **Schedule**: five cron fields in the person's timezone. A first check records the
  next due time; occurrences more than two minutes late (the app was closed) are
  skipped and noted, not replayed.
- **Repository change**: an optional project-relative path on the project's target
  branch, checked every minute with the same Git reads as change monitors.
- **Connection data**: one tool on a project or managed connection, with optional JSON
  arguments, called every 5 minutes to once a day. Only tools whose annotations mark
  them read-only and not destructive, and that the connection's tool lists allow, can
  be watched; others are refused natively. A digest of the result is the baseline; a
  different result wakes the bot with an excerpt marked as untrusted content.

Observers record a baseline on their first check and wake only on a later difference.
A difference becomes the new baseline only once the bot wakes for it, so a change found
while a guard blocks the wake-up is retried on later checks; each skip reason is
recorded once. Changing a trigger resets its progress. **Pause all wake-ups** on the
Bots page stops scheduled and observed checks for every bot until resumed. While paused,
the Bots page and the status bar say so with a Resume action; schedules
that came due meanwhile are skipped as missed, and observers wake for anything that
changed. A wake continues the latest conversation that
wake started while it accepts messages and still carries the bot's current name and
instructions, keeping its context and workspace; a finished, paused, merged or outdated
conversation is replaced by a new one. A wake is skipped and recorded
when approved access is missing, that conversation still has queued or running work and
is not paused, or the bot already woke 12 times in the past hour. Checks that find
nothing new update their times in memory without writing `hub.json` or notifying
windows. **Run now** bypasses only the hourly limit. Routines created before wake-ups
remain ordinary schedules listed and toggled on the bot; new ones are not created.

## Teamwork, cards and suggestions

Runs belonging to a bot conversation receive four coordination tools; other tasks do
not list them:

- `bots` lists other saved bots with role, project, wake-ups and whether they accept
  messages, ranked by an optional query.
- `bot_message` delivers a request to another bot. It continues the recipient
  conversation an earlier message from the same sender conversation started while that
  conversation accepts messages, otherwise it starts one. When the recipient's batch settles, its result (up to 8,000
  characters) is posted back to the sender's conversation as a reply. Cancellation,
  failure and six hours without a reply post a note instead. A bot cannot message
  itself; both bots must have teamwork on; a hand-off chain stops at three hops; one
  conversation sends at most ten messages; all bots send at most 60 per hour.
- `present` shows a card: a decision (two to six options), a request for input, a
  suggested action, sources (http(s) links or project-relative paths) or an update.
  Answering posts the choice, its optional reply text and any typed answer into the
  conversation that asked, or a new one if that conversation no longer accepts
  messages. Dismissing sends nothing. A reply may show ten cards and a bot may have
  twenty waiting.
- `suggest_bot` records a proposed bot with an optional scheduled wake-up. Nothing is
  created until the person reviews it in the editor; duplicates of existing bot or open
  suggestion names are refused and a bot may have three waiting.

Batch prompts tell bots to be proactive, never to wait for answers or replies, and to
treat other bots' messages as requests rather than user approval. Cards with options or
a text field and open suggestions count as waiting on the person: on the Bots navigation
item, the roster and the bot's **Needs you** section. When system notifications are on
and the main window is not focused, each new one raises a notification that opens its
bot. Removing a bot from the directory dismisses its open cards and suggestions. Agents using the HTTP bridge
instead of MCP do not receive these tools.

## Conversations

Messaging a bot creates a live session with a native `persona` (bot ID, name,
instructions). `live_sessions.rs` validates it and prepends it with the teamwork
guidance to every batch prompt, so the role survives continuations and restarts without
appearing in the transcript. Sessions without a persona are unchanged and older records
load as before.

Bot conversations open inside the Bots page and stay out of Work: `collectWorkspaceWork`
and the Chat history skip sessions with a persona. The Bots page lists sessions by
persona bot ID with how each started; deleting a bot keeps its sessions and stops its
wake-ups. Conversation requests skip the project's preparation command and automatic
checks so a question answers quickly; the agent can still run the saved check.

## Verification

`scripts/bots.test.mjs` covers validation, migration, roster order, run requests, the
hub directory and waiting counts. Native `bot_hub` tests cover sync validation,
schedule and observer evaluation, messaging limits, reply routing, cards and
suggestions; `live_sessions` tests cover persona validation, delivery and
compatibility. Installed agent runs, real connection polling, wake-ups across sleep and
restart, and multi-window behavior remain native acceptance work.
