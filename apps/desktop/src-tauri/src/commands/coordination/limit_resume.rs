use super::Coordinator;

impl Coordinator {
    /// Retries attempts a usage limit stopped once their reported reset has passed, as the
    /// person scheduled. The retry goes through the same guarded start as a manual one; one
    /// that cannot start keeps its reason on the attempt instead of trying again.
    pub(super) fn resume_limited(&self) {
        let now = chrono::Utc::now().timestamp();
        for (id, at) in self.runtime.take_due_limit_resumes(now) {
            let started = self
                .runtime
                .retry_request(&id)
                .and_then(|request| self.start_manual(request));
            if let Err(error) = started {
                self.runtime.limit_resume_failed(&id, at, error);
            }
        }
    }
}
