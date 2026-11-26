//! How long a verified account keeps its account features while offline. Only a
//! successful server check of an approved account starts the lease; it lasts at
//! most 72 hours from that check and never past the device credential's expiry.
//! Local execution never consults it: tasks, conversations and terminals run
//! with or without an account.

use std::sync::Mutex;

pub const OFFLINE_GRACE_MS: i64 = 72 * 60 * 60 * 1000;

#[derive(Default)]
struct Lease {
    checked_at: i64,
    expires_at: i64,
}

#[derive(Default)]
pub struct AccountLease {
    lease: Mutex<Lease>,
}

impl AccountLease {
    pub fn update(&self, checked_at: i64, expires_at: i64) {
        if let Ok(mut lease) = self.lease.lock() {
            *lease = Lease {
                checked_at,
                expires_at,
            };
        }
    }

    pub fn revoke(&self) {
        self.update(0, 0);
    }

    pub(super) fn current_at(&self, now: i64) -> bool {
        self.lease.lock().is_ok_and(|lease| {
            let until = lease
                .checked_at
                .saturating_add(OFFLINE_GRACE_MS)
                .min(lease.expires_at);
            lease.checked_at > 0 && now >= lease.checked_at && now < until
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_lease_needs_verification_and_expires_without_sliding_on_reads() {
        let lease = AccountLease::default();
        assert!(!lease.current_at(1000));
        lease.update(1000, i64::MAX);
        assert!(lease.current_at(1001));
        assert!(lease.current_at(1000 + OFFLINE_GRACE_MS - 1));
        assert!(!lease.current_at(1000 + OFFLINE_GRACE_MS));
        assert!(!lease.current_at(999));
        lease.update(1000, 2000);
        assert!(!lease.current_at(2000));
        lease.revoke();
        assert!(!lease.current_at(1001));
    }
}
