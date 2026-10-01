# Bots

Bots are saved agent profiles for repeated work. Use this guide when changing bot
storage, persona delivery or routines. See [UI guidelines](UI-GUIDELINES.md) for the
workspace and [core workflow](CORE-WORKFLOW.md) for the chat sessions bots start.

## Profiles

`stores/botStore.ts` keeps bots in renderer storage: name, role, standing instructions,
agent (`auto` or an agent ID), optional model, project, connection scope and the
schedule IDs created as routines. A `null` connection scope delivers every enabled
connection; a list becomes the run request's `connectionIds`. Edits apply to new
conversations and routines only. Templates in `lib/bot-templates.ts` prefill the editor
and never grant access, enable connections or start work.

## Conversations

Messaging a bot creates a live session with an optional native `persona` (bot ID,
name, instructions). `live_sessions.rs` validates it and prepends it to every batch
prompt, so the role survives continuations and restarts without appearing in the
transcript. Sessions without a persona are unchanged and older records load as before.
The Bots page lists sessions by persona bot ID; deleting a bot keeps its sessions.

## Routines

Routines are ordinary schedules whose prompt starts with the bot's identity and
instructions, created from the bot's request defaults. The bot records their IDs and
drops them once Automations no longer lists them. Timing, history and webhooks stay
in Automations.

## Verification

`scripts/bots.test.mjs` covers validation, roster order and routine prompts. Native
`live_sessions` tests cover persona validation, delivery and compatibility. Installed
agent runs, routine execution and multi-window behavior remain native acceptance work.
