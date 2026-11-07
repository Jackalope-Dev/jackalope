//! The product scopes Connect Cloudflare may request beyond its base scopes, and
//! the API token permission each one stands for.

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Scope {
    /// The OAuth scope: the permission in kebab case, `.write` for Edit.
    pub name: &'static str,
    /// The account API token permission, as the Cloudflare dashboard names it.
    pub permission: &'static str,
}

/// Requested only when the person sets up Jackalope Swarm, so Connect Cloudflare keeps
/// working for clients whose registration does not allow Workers yet.
pub(crate) const WORKERS: Scope = Scope {
    name: "workers-scripts.write",
    permission: "Workers Scripts: Edit",
};
pub(crate) const R2: Scope = Scope {
    name: "workers-r2-storage.write",
    permission: "Workers R2 Storage: Edit",
};
pub(crate) const D1: Scope = Scope {
    name: "d1.write",
    permission: "D1: Edit",
};
pub(crate) const KV: Scope = Scope {
    name: "workers-kv-storage.write",
    permission: "Workers KV Storage: Edit",
};
pub(crate) const QUEUES: Scope = Scope {
    name: "queues.write",
    permission: "Queues: Edit",
};
pub(crate) const HYPERDRIVE: Scope = Scope {
    name: "hyperdrive.write",
    permission: "Hyperdrive: Edit",
};
pub(crate) const TURNSTILE: Scope = Scope {
    name: "turnstile.write",
    permission: "Turnstile: Edit",
};

const ALL: [&Scope; 7] = [&WORKERS, &R2, &D1, &KV, &QUEUES, &HYPERDRIVE, &TURNSTILE];

/// The scope Jackalope may request under this name.
pub(crate) fn find(name: &str) -> Option<&'static Scope> {
    ALL.into_iter().find(|scope| scope.name == name)
}

/// Whether a space-separated grant includes `scope`.
pub(crate) fn granted(grant: &str, scope: &Scope) -> bool {
    grant.split_whitespace().any(|item| item == scope.name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_product_scopes_are_known() {
        assert_eq!(find("workers-scripts.write"), Some(&WORKERS));
        assert_eq!(
            find("d1.write").map(|scope| scope.permission),
            Some("D1: Edit")
        );
        assert_eq!(find("account-settings.read"), None);
        assert!(granted("artifacts.write d1.write", &D1));
        assert!(!granted("artifacts.write d1.read", &D1));
    }
}
