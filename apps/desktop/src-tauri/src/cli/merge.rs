//! The client side of delivering a conversation's work, shared by
//! `jackalope merge`/`pr` and `/merge`/`/pr`.
//!
//! The host prepares a merge of whatever the conversation last produced, so the
//! conversation is paused first and no new message starts mid-merge. A merge
//! that does not go ahead resumes what this paused.

use crate::connection::unexpected;
use crate::protocol::{MergePlan, Request, Response, SessionCommand};

/// Sends one request and returns the host's answer or its error.
pub type Call<'a> = dyn FnMut(Request) -> Result<Response, String> + 'a;

/// A merge ready to apply: the plan and whether preparing it paused the conversation.
pub struct Prepared {
    pub plan: MergePlan,
    pub paused_here: bool,
}

/// Pauses the conversation unless it is `paused` already, prepares the merge of
/// its latest attempt and checks there is something to merge without conflicts.
/// Every refusal resumes what this paused.
pub fn prepare(
    call: &mut Call,
    session_id: &str,
    paused: bool,
    message: Option<String>,
) -> Result<Prepared, String> {
    if !paused {
        pause(call, session_id, SessionCommand::Pause)?;
    }
    let refused = |call: &mut Call, error: String| {
        if !paused {
            let _ = pause(call, session_id, SessionCommand::Resume);
        }
        Err(error)
    };
    let plan = match call(Request::MergePrepare {
        session_id: session_id.to_string(),
        message,
    }) {
        Ok(Response::Merge { plan }) => plan,
        Ok(_) => return refused(call, unexpected()),
        Err(error) => return refused(call, error),
    };
    if !plan.conflicts.is_empty() {
        return refused(
            call,
            format!(
                "This work conflicts with {}: {}. Resolve them in the app's merge review.",
                plan.target_branch,
                plan.conflicts.join(", ")
            ),
        );
    }
    if plan.files.is_empty() {
        return refused(call, "There are no changes to merge.".into());
    }
    Ok(Prepared {
        plan,
        paused_here: !paused,
    })
}

/// Applies a prepared plan. A failed merge resumes the conversation when
/// preparing it paused it; a merged one stays paused for the person to resume.
pub fn apply(
    call: &mut Call,
    session_id: &str,
    paused_here: bool,
    plan_id: String,
    cleanup: bool,
) -> Result<MergePlan, String> {
    match call(Request::MergeApply { plan_id, cleanup }) {
        Ok(Response::Merge { plan }) => Ok(plan),
        other => {
            release(call, session_id, paused_here);
            Err(match other {
                Err(error) => error,
                Ok(_) => unexpected(),
            })
        }
    }
}

/// Resumes the conversation when preparing a merge paused it and the merge does not go ahead.
pub fn release(call: &mut Call, session_id: &str, paused_here: bool) {
    if paused_here {
        let _ = pause(call, session_id, SessionCommand::Resume);
    }
}

/// The description of a pull request opened from a conversation: its last reply.
pub fn pull_request_body(result: &str) -> String {
    result.trim().chars().take(4000).collect()
}

fn pause(call: &mut Call, session_id: &str, action: SessionCommand) -> Result<(), String> {
    call(Request::SessionAction {
        session_id: session_id.to_string(),
        action,
        message_id: None,
    })
    .map(|_| ())
}
