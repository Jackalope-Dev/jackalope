//! The connected Cloudflare account, shared by Artifacts, cloud resources and
//! Jackalope Swarm setup: the saved connection and its OAuth sign-in, the scopes
//! Jackalope may request, and the v4 account API client.

pub mod api;
pub mod connection;
pub(crate) mod oauth;
pub(crate) mod scopes;

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::cloudflare::connection::cloudflare_artifacts_status,
            commands::cloudflare::connection::cloudflare_token_accounts,
            commands::cloudflare::connection::cloudflare_artifacts_disconnect,
            commands::cloudflare::connection::cloudflare_oauth_begin,
            commands::cloudflare::connection::cloudflare_oauth_complete,
            commands::cloudflare::connection::cloudflare_oauth_cancel,
            commands::cloudflare::connection::cloudflare_oauth_reauthorize,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;
