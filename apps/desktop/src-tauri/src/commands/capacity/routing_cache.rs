use std::{
    collections::HashMap,
    future::Future,
    hash::Hash,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, Semaphore};

type Entry<V> = Arc<Mutex<Option<(Instant, V)>>>;

pub(super) struct RoutingCache<K, V> {
    entries: std::sync::Mutex<HashMap<K, Entry<V>>>,
    slots: Semaphore,
}

impl<K, V> Default for RoutingCache<K, V> {
    fn default() -> Self {
        Self {
            entries: Default::default(),
            slots: Semaphore::new(4),
        }
    }
}

impl<K: Eq + Hash + Clone, V: Clone> RoutingCache<K, V> {
    pub async fn get(&self, key: K, fetch: impl Future<Output = V>) -> V {
        let entry = {
            let mut entries = self.entries.lock().unwrap();
            if entries.len() >= 256 && !entries.contains_key(&key) {
                entries.retain(|_, entry| Arc::strong_count(entry) > 1);
            }
            if entries.len() >= 256 {
                entries.get(&key).cloned().unwrap_or_default()
            } else {
                entries.entry(key).or_default().clone()
            }
        };
        let mut value = entry.lock().await;
        if let Some((_, record)) = value
            .as_ref()
            .filter(|(at, _)| at.elapsed() < Duration::from_secs(60))
        {
            return record.clone();
        }
        let _slot = self
            .slots
            .acquire()
            .await
            .expect("capacity slots remain open");
        let record = fetch.await;
        *value = Some((Instant::now(), record.clone()));
        record
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn concurrent_readers_share_an_account_refresh_without_blocking_other_accounts() {
        let cache = Arc::new(RoutingCache::<u8, u8>::default());
        let calls = Arc::new(AtomicUsize::new(0));
        let (started, waiting) = tokio::sync::oneshot::channel();
        let (release, released) = tokio::sync::oneshot::channel();
        let first_cache = cache.clone();
        let first_calls = calls.clone();
        let first = tokio::spawn(async move {
            first_cache
                .get(1, async {
                    first_calls.fetch_add(1, Ordering::SeqCst);
                    started.send(()).unwrap();
                    released.await.unwrap();
                    7
                })
                .await
        });
        waiting.await.unwrap();
        assert_eq!(cache.get(2, async { 9 }).await, 9);
        let second_cache = cache.clone();
        let second_calls = calls.clone();
        let second = tokio::spawn(async move {
            second_cache
                .get(1, async {
                    second_calls.fetch_add(1, Ordering::SeqCst);
                    8
                })
                .await
        });
        release.send(()).unwrap();
        assert_eq!(first.await.unwrap(), 7);
        assert_eq!(second.await.unwrap(), 7);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn canceling_a_refresh_releases_its_account_and_slot() {
        let cache = Arc::new(RoutingCache::<u8, u8>::default());
        let (started, waiting) = tokio::sync::oneshot::channel();
        let first_cache = cache.clone();
        let first = tokio::spawn(async move {
            first_cache
                .get(1, async {
                    started.send(()).unwrap();
                    std::future::pending::<u8>().await
                })
                .await
        });
        waiting.await.unwrap();
        first.abort();
        assert!(first.await.unwrap_err().is_cancelled());
        assert_eq!(cache.get(1, async { 3 }).await, 3);
        assert_eq!(cache.slots.available_permits(), 4);
    }
}
