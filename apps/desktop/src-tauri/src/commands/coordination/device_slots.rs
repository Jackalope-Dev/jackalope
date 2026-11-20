//! How many agents this device runs at once when the queue's limit is Automatic.

use std::sync::OnceLock;

/// The most agents the queue runs at once on this device, automatic or chosen.
pub(super) const MAX_CONCURRENCY: usize = 16;

const GIB: u64 = 1024 * 1024 * 1024;

/// Agent runs this device takes at once: one per two CPUs and per 4 GiB of
/// memory, whichever allows fewer, from 1 to [`MAX_CONCURRENCY`]. This is the
/// budget an added computer's runner uses (`slots_for` in
/// resources/computer/agent.py): a run is mostly a network-bound agent CLI, but
/// the builds, tests, dev servers and Chromium it starts are not. Jackalope's
/// own checks also wait for a check slot. Memory is rounded to whole GiB;
/// unknown memory limits nothing.
pub(super) fn slots_for(cpus: usize, memory: Option<u64>) -> usize {
    let mut slots = (cpus / 2).min(MAX_CONCURRENCY);
    if let Some(bytes) = memory.filter(|bytes| *bytes > 0) {
        slots = slots.min(((bytes + GIB / 2) / GIB / 4) as usize);
    }
    slots.max(1)
}

/// [`slots_for`] this device, measured once.
pub(super) fn recommended() -> usize {
    static SLOTS: OnceLock<usize> = OnceLock::new();
    *SLOTS.get_or_init(|| {
        slots_for(
            std::thread::available_parallelism().map_or(1, |count| count.get()),
            memory(),
        )
    })
}

/// The limit a saved choice gives: the choice when it is in range, otherwise
/// (nothing saved, or a value this build does not accept) the recommendation.
pub(super) fn effective(saved: Option<usize>, recommended: usize) -> usize {
    saved
        .filter(|agents| (1..=MAX_CONCURRENCY).contains(agents))
        .unwrap_or(recommended)
}

/// Total physical memory in bytes.
#[cfg(unix)]
fn memory() -> Option<u64> {
    // SAFETY: sysconf only reads system configuration.
    let (pages, size) = unsafe {
        (
            libc::sysconf(libc::_SC_PHYS_PAGES),
            libc::sysconf(libc::_SC_PAGESIZE),
        )
    };
    (pages > 0 && size > 0).then(|| pages as u64 * size as u64)
}

#[cfg(windows)]
fn memory() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    // SAFETY: the structure is zeroed with its length set, as the call requires.
    unsafe {
        let mut status: MEMORYSTATUSEX = std::mem::zeroed();
        status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        (GlobalMemoryStatusEx(&mut status) != 0).then_some(status.ullTotalPhys)
    }
}

#[cfg(not(any(unix, windows)))]
fn memory() -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slots_follow_the_scarcer_of_cpus_and_memory() {
        // An 8 GB laptop with 8 cores runs two; a 16 GB one four.
        assert_eq!(slots_for(8, Some(8 * GIB)), 2);
        assert_eq!(slots_for(10, Some(16 * GIB)), 4);
        assert_eq!(slots_for(14, Some(36 * GIB)), 7);
        assert_eq!(slots_for(16, Some(64 * GIB)), 8);
        // Memory a little under its marketed size still counts as that size.
        assert_eq!(slots_for(16, Some(16 * GIB - 200 * 1024 * 1024)), 4);
        // Big workstations stop at the maximum; tiny machines still run one.
        assert_eq!(slots_for(64, Some(256 * GIB)), MAX_CONCURRENCY);
        assert_eq!(slots_for(1, Some(2 * GIB)), 1);
        assert_eq!(slots_for(0, None), 1);
        // Unknown memory leaves the CPUs to decide.
        assert_eq!(slots_for(12, None), 6);
        assert_eq!(slots_for(12, Some(0)), 6);
    }

    #[test]
    fn this_device_has_a_recommendation_in_range() {
        assert!((1..=MAX_CONCURRENCY).contains(&recommended()));
        assert!(memory().is_some_and(|bytes| bytes >= GIB));
    }

    #[test]
    fn saved_choices_win_and_anything_else_follows_the_device() {
        assert_eq!(effective(None, 7), 7);
        assert_eq!(effective(Some(3), 7), 3);
        assert_eq!(effective(Some(MAX_CONCURRENCY), 2), MAX_CONCURRENCY);
        assert_eq!(effective(Some(0), 7), 7);
        assert_eq!(effective(Some(MAX_CONCURRENCY + 1), 7), 7);
    }
}
