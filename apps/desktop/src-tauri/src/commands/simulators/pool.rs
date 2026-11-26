//! How many task Simulators may be booted at once, and which one makes room.

/// The default limit: one booted device per 8 GB of memory and per four
/// cores, at most three. `JACKALOPE_SIMULATOR_CONCURRENCY` (1–8) overrides it.
pub fn capacity(cores: usize, memory_bytes: Option<u64>, configured: Option<&str>) -> usize {
    if let Some(value) = configured
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| (1..=8).contains(value))
    {
        return value;
    }
    let by_memory = memory_bytes
        .map(|bytes| (bytes / (8 << 30)) as usize)
        .unwrap_or(1);
    (cores / 4).min(by_memory).clamp(1, 3)
}

pub fn concurrency() -> usize {
    capacity(
        std::thread::available_parallelism().map_or(4, |count| count.get()),
        memory_bytes(),
        std::env::var("JACKALOPE_SIMULATOR_CONCURRENCY")
            .ok()
            .as_deref(),
    )
}

fn memory_bytes() -> Option<u64> {
    static MEMORY: std::sync::OnceLock<Option<u64>> = std::sync::OnceLock::new();
    *MEMORY.get_or_init(read_memory)
}

fn read_memory() -> Option<u64> {
    #[cfg(target_os = "macos")]
    {
        let mut command = std::process::Command::new("/usr/sbin/sysctl");
        command.args(["-n", "hw.memsize"]);
        let output =
            crate::commands::process_control::run(command, std::time::Duration::from_secs(5))
                .ok()?;
        output.stdout.trim().parse().ok()
    }
    #[cfg(not(target_os = "macos"))]
    None
}

#[derive(Debug, PartialEq, Eq)]
pub enum Admit {
    /// The device is already booted.
    Ready,
    Boot,
    /// Shut this idle device down first.
    Evict(String),
    Wait,
}

/// Decides whether `target` may boot. `booted` lists Jackalope's booted or
/// booting devices; `idle` says whether one may be shut down to make room,
/// and the least recently active idle device goes first (`booted` is ordered
/// that way by the caller).
pub fn admit(target: &str, limit: usize, booted: &[String], idle: impl Fn(&str) -> bool) -> Admit {
    if booted.iter().any(|udid| udid == target) {
        return Admit::Ready;
    }
    if booted.len() < limit {
        return Admit::Boot;
    }
    booted
        .iter()
        .find(|udid| idle(udid))
        .map(|udid| Admit::Evict(udid.clone()))
        .unwrap_or(Admit::Wait)
}

#[cfg(test)]
mod tests {
    use super::*;

    const GB: u64 = 1 << 30;

    #[test]
    fn capacity_follows_memory_and_cores_within_bounds() {
        assert_eq!(capacity(16, Some(64 * GB), None), 3);
        assert_eq!(capacity(8, Some(16 * GB), None), 2);
        assert_eq!(capacity(8, Some(8 * GB), None), 1);
        assert_eq!(capacity(2, Some(4 * GB), None), 1);
        assert_eq!(capacity(16, None, None), 1);
        assert_eq!(capacity(16, Some(64 * GB), Some("5")), 5);
        assert_eq!(capacity(16, Some(64 * GB), Some("0")), 3);
        assert_eq!(capacity(16, Some(64 * GB), Some("9")), 3);
        assert_eq!(capacity(16, Some(64 * GB), Some("x")), 3);
    }

    #[test]
    fn admission_boots_within_the_limit_then_evicts_idle_devices_or_waits() {
        let booted = vec!["A".to_string(), "B".to_string()];
        assert_eq!(admit("A", 2, &booted, |_| false), Admit::Ready);
        assert_eq!(admit("C", 3, &booted, |_| false), Admit::Boot);
        assert_eq!(admit("C", 2, &booted, |_| false), Admit::Wait);
        assert_eq!(
            admit("C", 2, &booted, |udid| udid == "B"),
            Admit::Evict("B".into())
        );
        assert_eq!(admit("C", 2, &booted, |_| true), Admit::Evict("A".into()));
        assert_eq!(admit("A", 1, &[], |_| false), Admit::Boot);
    }
}
