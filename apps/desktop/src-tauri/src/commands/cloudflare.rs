//! The connected Cloudflare account, shared by Artifacts, cloud resources and
//! Jackalope Swarm setup: the saved connection and its OAuth sign-in, the scopes
//! Jackalope may request, and the v4 account API client.

pub mod api;
pub mod connection;
pub(crate) mod oauth;
pub(crate) mod scopes;
