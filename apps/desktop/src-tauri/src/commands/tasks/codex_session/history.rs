//! Rewinding and branching a Codex conversation through the app-server.
//!
//! Both work on the thread an attempt ran, while no turn of it is running: in the
//! conversation's warm process when one is parked, otherwise in a new app-server that
//! resumes the thread for the change and exits. Rolling back changes only the
//! conversation Codex keeps; it does not revert the workspace's files. Codex can roll back
//! only threads with paginated history (every thread Codex 0.156 creates); a thread saved
//! with legacy history fails with that reason.
// Runtime capabilities for rewinding a conversation and side chats; the app does not call
// them yet.
#![cfg_attr(not(test), allow(dead_code))]

use super::*;

const LIST_PAGE: u64 = 100;
/// Turns read before a listing gives up.
const LIST_LIMIT: usize = 5000;

/// A Codex thread after a rollback or fork.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::commands) struct CodexThread {
    /// The thread to continue: the same thread after a rollback, the new one after a fork.
    pub thread_id: String,
    /// The thread's turn IDs, oldest first.
    pub turns: Vec<String>,
}

/// The IDs of up to `count` of the thread's newest turns, newest first.
fn newest_turns(
    connection: &Connection,
    thread: &str,
    count: usize,
) -> Result<Vec<String>, RpcError> {
    let mut turns = Vec::new();
    let mut cursor: Option<String> = None;
    while turns.len() < count.min(LIST_LIMIT) {
        let page = connection.call(
            "thread/turns/list",
            json!({
                "threadId": thread,
                "cursor": cursor,
                "limit": LIST_PAGE.min((count - turns.len()) as u64),
                "sortDirection": "desc",
                "itemsView": "notLoaded",
            }),
            THREAD_LIMIT,
        )?;
        let before = turns.len();
        turns.extend(
            page["data"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|turn| turn["id"].as_str().map(str::to_string)),
        );
        let next = page["nextCursor"].as_str().map(str::to_string);
        if next.is_none() || next == cursor || turns.len() == before {
            break;
        }
        cursor = next;
    }
    turns.truncate(count);
    Ok(turns)
}

fn all_turns(connection: &Connection, thread: &str) -> Result<Vec<String>, RpcError> {
    let mut turns = newest_turns(connection, thread, LIST_LIMIT)?;
    turns.reverse();
    Ok(turns)
}

/// `error` for a change named `what`, saying when the installed Codex lacks it.
fn failed(what: &str, error: RpcError) -> String {
    if error.missing_method() {
        format!("This Codex version cannot {what}: {error}. Update Codex and try again.")
    } else {
        format!("Codex could not {what}: {error}")
    }
}

impl TaskRuntime {
    /// Drops the last `turns` turns of the Codex conversation attempt `run_id` ran, so the
    /// next turn continues from before them. Files the dropped turns changed stay as they
    /// are. Returns the conversation's remaining turns.
    pub(in crate::commands) fn rollback_codex_thread(
        &self,
        run_id: &str,
        turns: usize,
    ) -> Result<CodexThread, String> {
        self.with_codex_thread(run_id, |connection, thread| {
            if turns > 0 {
                let newest = newest_turns(connection, thread, turns)
                    .map_err(|error| failed("read the conversation's turns", error))?;
                if newest.len() < turns {
                    return Err(format!(
                        "The conversation has {} turn{}, fewer than the {turns} to roll back.",
                        newest.len(),
                        if newest.len() == 1 { "" } else { "s" }
                    ));
                }
                connection
                    .call(
                        "thread/revert",
                        json!({"threadId": thread, "beforeTurnId": newest[turns - 1]}),
                        THREAD_LIMIT,
                    )
                    .map_err(|error| failed("roll back the conversation", error))?;
            }
            Ok(CodexThread {
                thread_id: thread.to_string(),
                turns: all_turns(connection, thread)
                    .map_err(|error| failed("read the conversation's turns", error))?,
            })
        })
    }

    /// Copies the Codex conversation attempt `run_id` ran into a new thread without its
    /// last `drop_turns` turns, leaving the original as it is. The new thread is saved,
    /// so a later attempt continues it by its ID.
    pub(in crate::commands) fn fork_codex_thread(
        &self,
        run_id: &str,
        drop_turns: usize,
    ) -> Result<CodexThread, String> {
        let workspace = self
            .run_snapshot(run_id)
            .map(|run| run.workspace)
            .unwrap_or_default();
        self.with_codex_thread(run_id, |connection, thread| {
            let mut params = json!({"threadId": thread, "excludeTurns": true, "cwd": workspace});
            if drop_turns > 0 {
                let newest = newest_turns(connection, thread, drop_turns + 1)
                    .map_err(|error| failed("read the conversation's turns", error))?;
                let Some(last) = newest.get(drop_turns) else {
                    return Err(format!(
                        "The conversation has {} turn{}, so dropping {drop_turns} would leave nothing to fork.",
                        newest.len(),
                        if newest.len() == 1 { "" } else { "s" }
                    ));
                };
                params["lastTurnId"] = json!(last);
            }
            let forked = connection
                .call("thread/fork", params, THREAD_LIMIT)
                .map_err(|error| failed("fork the conversation", error))?;
            let id = forked["thread"]["id"]
                .as_str()
                .ok_or("Codex forked the conversation without naming the new thread.")?
                .to_string();
            Ok(CodexThread {
                turns: all_turns(connection, &id)
                    .map_err(|error| failed("read the forked conversation's turns", error))?,
                thread_id: id,
            })
        })
    }

    /// Runs `change` on the thread of attempt `run_id`, loaded in an app-server.
    fn with_codex_thread<T>(
        &self,
        run_id: &str,
        change: impl FnOnce(&Connection, &str) -> Result<T, String>,
    ) -> Result<T, String> {
        let run = self.run_snapshot(run_id).ok_or("Attempt not found")?;
        let adapter = run
            .account_binding
            .as_ref()
            .map(|binding| binding.adapter.clone())
            .map_or_else(|| self.policy()?.adapter(&run.agent), Ok)?;
        if adapter != "codex" {
            return Err("Only Codex conversations can be rolled back or forked here.".into());
        }
        if run.remote.is_some() || run.host.as_ref().is_some_and(|host| !host.is_device()) {
            return Err("This conversation ran on a computer; change it there.".into());
        }
        let thread = run
            .session_id
            .clone()
            .ok_or("This attempt has no Codex conversation to change.")?;
        let busy = self.inner.lock().unwrap().runs.values().any(|other| {
            other.status.is_active()
                && (other.session_id.as_deref() == Some(thread.as_str())
                    || (!run.workspace.is_empty() && other.workspace == run.workspace))
        });
        if busy {
            return Err("Stop the running turn before changing this conversation.".into());
        }
        if let Some(session) = self.codex_sessions.pool.take_any(&thread, &run.workspace) {
            let result = change(&session.connection, &thread);
            if session.process.alive() {
                self.codex_sessions.pool.park(session);
            }
            return result;
        }
        let executable = self.policy()?.resolve(&run.agent)?.1;
        let mut cmd = super::super::command(executable);
        if let Some(binding) = &run.account_binding {
            crate::commands::agent_profiles::apply_binding(&mut cmd, binding)?;
        }
        if !run.workspace.is_empty() {
            cmd.current_dir(&run.workspace);
        }
        cmd.args(["app-server", "--listen", "stdio://"]);
        let (session, _) =
            Session::spawn(&mut cmd, &run.agent, [0; 32], &run.workspace, None, None)?;
        session
            .initialize()
            .map_err(|error| format!("Codex's app-server did not start: {error}"))?;
        let mut params = json!({"threadId": thread, "excludeTurns": true});
        if !run.workspace.is_empty() {
            params["cwd"] = json!(run.workspace);
        }
        let resumed = session
            .connection
            .call("thread/resume", params, THREAD_LIMIT)
            .map_err(|error| failed("open the conversation", error))?;
        if resumed["thread"]["historyMode"] == "legacy" {
            return Err("This conversation was saved with Codex's legacy history, which Codex cannot roll back or fork by turn.".into());
        }
        change(&session.connection, &thread)
    }
}
