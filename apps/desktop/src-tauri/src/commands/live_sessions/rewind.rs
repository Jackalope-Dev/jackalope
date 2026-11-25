//! Rewinding a conversation to an earlier batch. The runtime restores the files and the
//! agent's conversation (`tasks::rewind`); this side holds the dispatch gate so no queued
//! message starts on the rewound work, and clears an error the undone turns left.

use super::*;
use crate::commands::tasks::rewind::RewindOutcome;

impl LiveSessions {
    /// The conversation, checked to be settled with nothing waiting to run.
    fn settled_session(&self, id: &str, run_id: &str) -> Result<LiveSession, String> {
        let integrated = self.integrated_ids()?;
        let session = {
            let inner = self.inner.lock().map_err(|e| e.to_string())?;
            if let Some(error) = &inner.error {
                return Err(error.clone());
            }
            inner
                .ledger
                .sessions
                .iter()
                .find(|session| session.id == id)
                .cloned()
                .ok_or("Conversation not found")?
        };
        Self::ensure_unintegrated(&session, &integrated)?;
        if !session.batches.iter().any(|batch| batch.run_id == run_id) {
            return Err("This turn is not part of the conversation.".into());
        }
        if session.batches.last().is_some_and(|batch| !batch.settled) {
            return Err("Stop the running turn before rewinding.".into());
        }
        if session
            .messages
            .iter()
            .any(|message| message.run_id.is_none() && !message.canceled)
        {
            return Err("Send or cancel the queued messages before rewinding.".into());
        }
        Ok(session)
    }

    /// Rewinds conversation `id` to the batch attempt `run_id` ran.
    pub(in crate::commands) fn rewind(
        &self,
        id: &str,
        run_id: &str,
        latest_run_id: &str,
    ) -> Result<RewindOutcome, String> {
        self.settled_session(id, run_id)?;
        // A Codex fork can take seconds, so it happens before the gate; the checks repeat
        // under it and the coordinator rechecks the attempts under the execution guard.
        let prepared = self.runtime.prepare_rewind(run_id, latest_run_id)?;
        let _gate = self.gate.lock().map_err(|e| e.to_string())?;
        let session = self.settled_session(id, run_id)?;
        if session.closed {
            return Err("Reopen this conversation before rewinding it.".into());
        }
        let mut outcome = self.coordinator.rewind(prepared)?;
        // The composer gets the person's own messages, not the batch's wrapped prompt.
        if let Some(batch) = session.batches.iter().find(|batch| batch.run_id == run_id) {
            outcome.prompt = session
                .messages
                .iter()
                .filter(|message| batch.message_ids.contains(&message.id) && !message.canceled)
                .map(|message| message.text.as_str())
                .collect::<Vec<_>>()
                .join("\n\n");
        }
        self.update(|ledger| {
            let session = Self::session(ledger, id)?;
            session.error = None;
            session.resume_at_reset = None;
            session.updated_at = Utc::now().to_rfc3339();
            Ok(())
        })?;
        Ok(outcome)
    }

    /// Undoes the rewind kept on attempt `run_id` of conversation `id`.
    pub(in crate::commands) fn undo_rewind(&self, id: &str, run_id: &str) -> Result<(), String> {
        let _gate = self.gate.lock().map_err(|e| e.to_string())?;
        self.settled_session(id, run_id)?;
        self.coordinator.undo_rewind(run_id)?;
        self.update(|ledger| {
            Self::session(ledger, id)?.updated_at = Utc::now().to_rfc3339();
            Ok(())
        })
    }
}
