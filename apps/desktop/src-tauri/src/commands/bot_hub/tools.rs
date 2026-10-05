use super::{
    clip, BotCard, BotHub, BotProposal, CardOption, CardSource, HubBot, ProposedWake, Relay,
    HOURLY_MESSAGES, MAX_CARDS, MAX_DEPTH, SESSION_MESSAGES,
};
use crate::commands::{live_sessions::MessageOrigin, tasks::TaskRun};
use chrono::{Duration as Span, Utc};
use rmcp::schemars;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

/// Tools only bot conversations receive.
pub const BOT_TOOLS: &[&str] = &["bots", "bot_message", "present", "suggest_bot"];

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DirectoryInput {
    #[schemars(
        description = "Optional words describing the help you need; bots are ranked by how well their name, role and instructions match."
    )]
    #[serde(default)]
    pub query: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BotMessageInput {
    #[schemars(description = "Recipient bot ID from bots.")]
    pub bot_id: String,
    #[schemars(
        description = "Self-contained request or update, at most 6000 characters. Include the context the other bot needs."
    )]
    pub text: String,
    #[schemars(
        description = "Return the other bot's reply to this conversation as a new message. Default true."
    )]
    #[serde(default = "yes")]
    pub expect_reply: bool,
}

fn yes() -> bool {
    true
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct OptionInput {
    #[schemars(description = "Button label, at most 60 characters.")]
    pub label: String,
    #[schemars(
        description = "Optional detail you receive when the user picks this option, at most 1000 characters."
    )]
    pub reply: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SourceInput {
    pub title: String,
    #[schemars(description = "An http or https link.")]
    pub url: Option<String>,
    #[schemars(description = "A project-relative file path.")]
    pub path: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CardKind {
    Decision,
    Input,
    Action,
    Sources,
    Update,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PresentInput {
    #[schemars(
        description = "decision: choose between options; input: ask for information; action: recommend a next step; sources: share links or files; update: report something notable."
    )]
    pub kind: CardKind,
    #[schemars(description = "At most 120 characters.")]
    pub title: String,
    #[schemars(description = "Markdown context, at most 4000 characters.")]
    #[serde(default)]
    pub body: String,
    #[schemars(description = "Up to six choices. The user's pick arrives as a new message.")]
    #[serde(default)]
    pub options: Vec<OptionInput>,
    #[schemars(description = "Up to twelve links or files.")]
    #[serde(default)]
    pub sources: Vec<SourceInput>,
    #[schemars(description = "Let the user type an answer. Defaults to true for input cards.")]
    pub allow_text: Option<bool>,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct WakeInput {
    pub name: String,
    #[schemars(description = "What the new bot should do when it wakes.")]
    pub prompt: String,
    #[schemars(description = "Five cron fields in the user's timezone, such as 0 9 * * 1-5.")]
    pub schedule: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SuggestBotInput {
    #[schemars(description = "At most 60 characters.")]
    pub name: String,
    #[schemars(description = "One line, at most 120 characters.")]
    pub role: String,
    #[schemars(description = "Standing instructions, at most 6000 characters.")]
    pub instructions: String,
    #[schemars(description = "Why this bot would help, at most 600 characters.")]
    pub reason: String,
    #[schemars(description = "Optional scheduled wake-up for the new bot.")]
    pub wake_up: Option<WakeInput>,
}

fn bounded(value: &str, limit: usize, field: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > limit {
        return Err(format!("Use a {field} between 1 and {limit} characters."));
    }
    Ok(value.into())
}

fn words(value: &str) -> Vec<String> {
    value
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| word.chars().count() > 2)
        .map(str::to_lowercase)
        .collect()
}

impl BotHub {
    /// The bot behind a task, if the task belongs to a bot conversation.
    pub(crate) fn caller(&self, run: &TaskRun) -> Result<(HubBot, String), String> {
        let session = run
            .live_session_id
            .clone()
            .ok_or("Only bot conversations can use bot tools.")?;
        let persona = self
            .sessions
            .persona(&session)
            .ok_or("Only bot conversations can use bot tools.")?;
        let bot = self
            .read(|ledger| ledger.bot(&persona.bot_id).cloned())?
            .ok_or("This bot is no longer saved.")?;
        Ok((bot, session))
    }

    pub(crate) fn is_bot_run(&self, run: &TaskRun) -> bool {
        self.caller(run).is_ok()
    }

    pub(crate) fn directory(&self, run: &TaskRun, input: DirectoryInput) -> Result<Value, String> {
        let (me, _) = self.caller(run)?;
        let terms = words(&input.query);
        let (bots, wakes) = self.read(|ledger| (ledger.bots.clone(), ledger.wakes.clone()))?;
        let mut listed: Vec<(usize, Value)> = bots
            .iter()
            .filter(|bot| bot.id != me.id)
            .map(|bot| {
                let haystack = words(&format!("{} {} {}", bot.name, bot.role, bot.instructions));
                let score = terms
                    .iter()
                    .filter(|term| haystack.iter().any(|word| word.starts_with(term.as_str())))
                    .count();
                let working = wakes
                    .iter()
                    .filter(|state| state.bot_id == bot.id)
                    .filter_map(|state| state.last_session_id.as_deref())
                    .any(|id| self.sessions.busy(id));
                (
                    score,
                    json!({
                        "id": bot.id,
                        "name": bot.name,
                        "role": bot.role,
                        "sameProject": bot.request.project_id == me.request.project_id,
                        "project": bot.request.project_name,
                        "acceptsMessages": bot.collaborate,
                        "working": working,
                        "wakeUps": bot.wakes.iter().filter(|wake| wake.enabled).map(|wake| wake.name.clone()).collect::<Vec<_>>(),
                        "instructions": clip(&bot.instructions, 400),
                    }),
                )
            })
            .collect();
        listed.sort_by(|a, b| b.0.cmp(&a.0));
        Ok(json!({
            "you": {"id": me.id, "name": me.name},
            "canMessage": me.collaborate,
            "bots": listed.into_iter().take(40).map(|(_, bot)| bot).collect::<Vec<_>>(),
        }))
    }

    pub(crate) fn message(&self, run: &TaskRun, input: BotMessageInput) -> Result<Value, String> {
        let (me, session) = self.caller(run)?;
        let text = bounded(&input.text, 6_000, "message")?;
        if !me.collaborate {
            return Err("The user turned off messaging other bots for this bot.".into());
        }
        if input.bot_id == me.id {
            return Err("Send messages to another bot, not yourself.".into());
        }
        let now = Utc::now();
        let (to, depth, existing, sent, recent) = self.read(|ledger| {
            (
                ledger.bot(&input.bot_id).cloned(),
                ledger.depths.get(&session).copied().unwrap_or(0),
                ledger
                    .relays
                    .iter()
                    .rev()
                    .find(|relay| {
                        relay.from_session_id == session && relay.to_bot_id == input.bot_id
                    })
                    .map(|relay| relay.to_session_id.clone()),
                ledger
                    .relays
                    .iter()
                    .filter(|relay| relay.from_session_id == session)
                    .count(),
                ledger
                    .relays
                    .iter()
                    .filter(|relay| now - relay.created_at < Span::hours(1))
                    .count(),
            )
        })?;
        let to = to.ok_or("No saved bot has that ID. Call bots for current IDs.")?;
        if !to.collaborate {
            return Err(format!(
                "{} does not accept messages from other bots.",
                to.name
            ));
        }
        if depth >= MAX_DEPTH {
            return Err("This conversation is already several hand-offs deep. Present what you found to the user instead.".into());
        }
        if sent >= SESSION_MESSAGES {
            return Err("This conversation has sent the most messages to other bots it can. Present the open question to the user instead.".into());
        }
        if recent >= HOURLY_MESSAGES {
            return Err(
                "Bots have sent many messages in the last hour. Try again later or ask the user."
                    .into(),
            );
        }
        let origin = MessageOrigin {
            kind: "bot".into(),
            label: format!("From {}", me.name),
            bot_id: Some(me.id.clone()),
            bot_name: Some(me.name.clone()),
            session_id: Some(session.clone()),
        };
        let (target, message) = self.deliver(&to, &text, origin, existing.as_deref())?;
        let relay = Relay {
            id: Uuid::new_v4().to_string(),
            from_bot_id: me.id.clone(),
            from_session_id: session.clone(),
            to_bot_id: to.id.clone(),
            to_session_id: target.clone(),
            message_id: message,
            depth: depth + 1,
            expect_reply: input.expect_reply,
            created_at: now,
            done: !input.expect_reply,
        };
        self.update(|ledger| {
            let deeper = ledger
                .depths
                .get(&target)
                .copied()
                .unwrap_or(0)
                .max(depth + 1);
            ledger.depths.insert(target.clone(), deeper);
            if ledger.depths.len() > 1_000 {
                let first = ledger.depths.keys().next().cloned();
                if let Some(first) = first {
                    ledger.depths.remove(&first);
                }
            }
            ledger.relays.push(relay);
            ledger.event(
                "message",
                &me.id,
                Some(&to.id),
                Some(&session),
                format!("{} messaged {}: {}", me.name, to.name, clip(&text, 160)),
            );
            Ok(())
        })?;
        Ok(json!({
            "status": "sent",
            "to": to.name,
            "conversationId": target,
            "reply": if input.expect_reply { "The reply will arrive in this conversation as a new message. Finish your current reply now." } else { "No reply requested." },
        }))
    }

    pub(crate) fn present(&self, run: &TaskRun, input: PresentInput) -> Result<Value, String> {
        let (me, session) = self.caller(run)?;
        let title = bounded(&input.title, 120, "title")?;
        if input.body.chars().count() > 4_000 {
            return Err("Keep the card body under 4,000 characters.".into());
        }
        if input.options.len() > 6 || input.sources.len() > 12 {
            return Err("Offer at most six options and twelve sources.".into());
        }
        let options = input
            .options
            .into_iter()
            .map(|option| {
                Ok(CardOption {
                    label: bounded(&option.label, 60, "option label")?,
                    reply: option
                        .reply
                        .map(|reply| bounded(&reply, 1_000, "option reply"))
                        .transpose()?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let sources = input
            .sources
            .into_iter()
            .map(|source| {
                let url = source
                    .url
                    .map(|url| url.trim().to_owned())
                    .filter(|url| !url.is_empty());
                let path = source
                    .path
                    .map(|path| path.trim().to_owned())
                    .filter(|path| !path.is_empty());
                if url.as_ref().is_some_and(|url| {
                    url.len() > 2_000
                        || !(url.starts_with("https://") || url.starts_with("http://"))
                }) {
                    return Err("Source links must be http or https.".to_string());
                }
                if path.as_ref().is_some_and(|path| {
                    path.len() > 500
                        || path.contains("..")
                        || path.starts_with('/')
                        || path.contains(':')
                }) {
                    return Err("Source files must be project-relative paths.".to_string());
                }
                if url.is_none() && path.is_none() {
                    return Err("Give each source a link or a file path.".to_string());
                }
                Ok(CardSource {
                    title: bounded(&source.title, 160, "source title")?,
                    url,
                    path,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let kind = match input.kind {
            super::tools::CardKind::Decision => "decision",
            super::tools::CardKind::Input => "input",
            super::tools::CardKind::Action => "action",
            super::tools::CardKind::Sources => "sources",
            super::tools::CardKind::Update => "update",
        };
        let allow_text = input.allow_text.unwrap_or(kind == "input");
        if kind == "decision" && options.len() < 2 {
            return Err("A decision needs at least two options.".into());
        }
        if kind == "sources" && sources.is_empty() {
            return Err("Share at least one source.".into());
        }
        let card = BotCard {
            id: Uuid::new_v4().to_string(),
            bot_id: me.id.clone(),
            bot_name: me.name.clone(),
            session_id: session.clone(),
            run_id: run.id.clone(),
            kind: kind.into(),
            title: title.clone(),
            body: input.body.trim().into(),
            options,
            sources,
            allow_text,
            status: "open".into(),
            answer: None,
            created_at: Utc::now().to_rfc3339(),
            resolved_at: None,
        };
        let id = card.id.clone();
        let waits = card.needs_response();
        self.update(|ledger| {
            if ledger.cards.iter().filter(|card| card.run_id == run.id).count() >= 10 {
                return Err("This reply already has ten cards. Combine the rest into one.".into());
            }
            if ledger.cards.iter().filter(|card| card.bot_id == me.id && card.needs_response()).count() >= 20 && waits {
                return Err("Twenty of this bot's cards are waiting on the user. Wait for answers before asking more.".into());
            }
            ledger.cards.push(card);
            if ledger.cards.len() > MAX_CARDS {
                if let Some(index) = ledger.cards.iter().position(|card| card.status != "open") {
                    ledger.cards.remove(index);
                }
            }
            ledger.event("card", &me.id, None, Some(&session), format!("{}: {title}", me.name));
            Ok(())
        })?;
        Ok(json!({
            "cardId": id,
            "status": "shown",
            "next": if waits { "The user's answer arrives as a new message. Finish your reply without waiting." } else { "Shown to the user." },
        }))
    }

    pub(crate) fn suggest(&self, run: &TaskRun, input: SuggestBotInput) -> Result<Value, String> {
        let (me, session) = self.caller(run)?;
        let name = bounded(&input.name, 60, "name")?;
        let role = bounded(&input.role, 120, "role")?;
        let instructions = bounded(&input.instructions, 6_000, "instructions")?;
        let reason = bounded(&input.reason, 600, "reason")?;
        let wake = input
            .wake_up
            .map(|wake| {
                crate::commands::schedules::next_at(&wake.schedule, "UTC", Utc::now())?;
                Ok::<_, String>(ProposedWake {
                    name: bounded(&wake.name, 80, "wake-up name")?,
                    prompt: bounded(&wake.prompt, 4_000, "wake-up prompt")?,
                    expression: wake.schedule.trim().into(),
                })
            })
            .transpose()?;
        let proposal = BotProposal {
            id: Uuid::new_v4().to_string(),
            from_bot_id: me.id.clone(),
            from_bot_name: me.name.clone(),
            session_id: session.clone(),
            name: name.clone(),
            role,
            instructions,
            reason,
            wake,
            status: "open".into(),
            created_bot_id: None,
            created_at: Utc::now().to_rfc3339(),
        };
        let id = proposal.id.clone();
        self.update(|ledger| {
            let taken = |other: &str| other.trim().eq_ignore_ascii_case(&name);
            if ledger.bots.iter().any(|bot| taken(&bot.name))
                || ledger
                    .proposals
                    .iter()
                    .any(|item| item.status == "open" && taken(&item.name))
            {
                return Err(format!(
                    "A bot or open suggestion named {name} already exists. Use bots to find it."
                ));
            }
            if ledger
                .proposals
                .iter()
                .filter(|item| item.status == "open" && item.from_bot_id == me.id)
                .count()
                >= 3
            {
                return Err("This bot already has three suggestions waiting on the user.".into());
            }
            ledger.proposals.push(proposal);
            if ledger.proposals.len() > 200 {
                if let Some(index) = ledger
                    .proposals
                    .iter()
                    .position(|item| item.status != "open")
                {
                    ledger.proposals.remove(index);
                }
            }
            ledger.event(
                "proposal",
                &me.id,
                None,
                Some(&session),
                format!("{} suggested a new bot: {name}", me.name),
            );
            Ok(())
        })?;
        Ok(
            json!({"proposalId": id, "status": "The user can create or dismiss this suggestion on the Bots page."}),
        )
    }
}
