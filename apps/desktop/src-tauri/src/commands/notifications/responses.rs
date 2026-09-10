use std::{collections::VecDeque, sync::Mutex};
use tokio::sync::oneshot;

#[cfg(unix)]
pub const LIFETIME: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);
const LIMIT: usize = 64;

#[derive(Default)]
struct Pending {
    closed: bool,
    senders: VecDeque<oneshot::Sender<()>>,
}

#[derive(Default)]
pub struct Responses(Mutex<Pending>);

impl Responses {
    pub fn register(&self) -> oneshot::Receiver<()> {
        let (sender, receiver) = oneshot::channel();
        let mut pending = self.0.lock().unwrap();
        if pending.closed {
            return receiver;
        }
        pending.senders.retain(|sender| !sender.is_closed());
        if pending.senders.len() == LIMIT {
            if let Some(oldest) = pending.senders.pop_front() {
                let _ = oldest.send(());
            }
        }
        pending.senders.push_back(sender);
        receiver
    }

    pub fn close(&self) {
        let mut pending = self.0.lock().unwrap();
        pending.closed = true;
        pending.senders.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evicts_oldest_and_cancels_on_shutdown() {
        let pending = Responses::default();
        let mut first = pending.register();
        let mut live: Vec<_> = (0..LIMIT).map(|_| pending.register()).collect();
        assert_eq!(first.try_recv(), Ok(()));
        assert_eq!(pending.0.lock().unwrap().senders.len(), LIMIT);
        assert!(live[0].try_recv().is_err());
        pending.close();
        assert_eq!(
            pending.register().try_recv(),
            Err(oneshot::error::TryRecvError::Closed)
        );
        assert!(live
            .iter_mut()
            .all(|receiver| receiver.try_recv() == Err(oneshot::error::TryRecvError::Closed)));
    }

    #[test]
    fn completed_waiters_do_not_evict_live_notices() {
        let pending = Responses::default();
        let mut first = pending.register();
        for _ in 0..LIMIT * 2 {
            drop(pending.register());
        }
        assert_eq!(first.try_recv(), Err(oneshot::error::TryRecvError::Empty));
        assert_eq!(pending.0.lock().unwrap().senders.len(), 2);
    }
}
