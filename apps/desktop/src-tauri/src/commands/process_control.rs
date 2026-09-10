use std::{
    io::{BufRead, Read},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

pub const OUTPUT_LIMIT: usize = 128_000;

pub fn read_bounded(mut reader: impl Read, limit: usize) -> std::io::Result<(String, bool)> {
    read_observed(&mut reader, limit, |_| {})
}

fn read_observed(
    mut reader: impl Read,
    limit: usize,
    mut observe: impl FnMut(&[u8]),
) -> std::io::Result<(String, bool)> {
    let mut kept = Vec::new();
    let mut buffer = [0; 8192];
    let mut truncated = false;
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        observe(&buffer[..count]);
        let take = count.min(limit.saturating_sub(kept.len()));
        kept.extend_from_slice(&buffer[..take]);
        truncated |= take < count;
    }
    Ok((String::from_utf8_lossy(&kept).into_owned(), truncated))
}

pub fn bounded_lines(
    mut reader: impl BufRead,
    limit: usize,
    mut consume: impl FnMut(String, bool),
) -> std::io::Result<()> {
    let mut line = Vec::new();
    let mut truncated = false;
    loop {
        let bytes = reader.fill_buf()?;
        if bytes.is_empty() {
            if !line.is_empty() || truncated {
                consume(String::from_utf8_lossy(&line).into_owned(), truncated);
            }
            return Ok(());
        }
        let end = bytes.iter().position(|b| *b == b'\n').map(|i| i + 1);
        let size = end.unwrap_or(bytes.len());
        let take = size.min(limit.saturating_sub(line.len()));
        line.extend_from_slice(&bytes[..take]);
        truncated |= take < size;
        reader.consume(size);
        if end.is_some() {
            consume(
                String::from_utf8_lossy(&line)
                    .trim_end_matches(['\r', '\n'])
                    .to_owned(),
                truncated,
            );
            line.clear();
            truncated = false;
        }
    }
}

#[cfg(windows)]
pub struct ProcessTree(std::os::windows::io::OwnedHandle);

#[cfg(windows)]
impl ProcessTree {
    pub fn attach(child: &Child) -> Result<Self, String> {
        use std::os::windows::io::AsRawHandle;
        Self::attach_handle(child.as_raw_handle())
    }

    pub fn attach_pid(pid: u32) -> Result<Self, String> {
        use std::os::windows::io::{AsRawHandle, FromRawHandle};
        use windows_sys::Win32::System::Threading::*;
        let handle = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid) };
        if handle.is_null() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let owned = unsafe { std::os::windows::io::OwnedHandle::from_raw_handle(handle) };
        Self::attach_handle(owned.as_raw_handle())
    }

    fn attach_handle(process: std::os::windows::io::RawHandle) -> Result<Self, String> {
        use std::os::windows::io::FromRawHandle;
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let owned = std::os::windows::io::OwnedHandle::from_raw_handle(handle);
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as _,
                std::mem::size_of_val(&info) as u32,
            ) == 0
                || AssignProcessToJobObject(handle, process) == 0
            {
                return Err(format!(
                    "Cannot contain task processes: {}",
                    std::io::Error::last_os_error()
                ));
            }
            Ok(Self(owned))
        }
    }

    pub fn terminate(&self) {
        use std::os::windows::io::AsRawHandle;
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0.as_raw_handle(), 1);
        }
    }
}

#[cfg(unix)]
pub struct ProcessTree {
    group: i32,
    guardian: std::sync::Mutex<Option<Child>>,
}

#[cfg(unix)]
impl ProcessTree {
    pub fn attach(child: &Child) -> Result<Self, String> {
        Self::attach_pid(child.id())
    }
    pub fn attach_pid(pid: u32) -> Result<Self, String> {
        let group = i32::try_from(pid).map_err(|_| "Invalid child process ID")?;
        if group <= 1 || unsafe { libc::getpgrp() } == group {
            return Err("Cannot contain the application's own process group.".into());
        }
        let actual = unsafe { libc::getpgid(group) };
        if actual != group
            && !(actual == -1
                && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH))
        {
            return Err("The child does not own an isolated process group.".into());
        }
        use std::os::unix::process::CommandExt;
        // This separate process observes EOF even if Jackalope is killed without running Drop.
        // CLOEXEC on the parent's pipe prevents agent grandchildren from keeping it alive.
        let guardian = Command::new("/bin/sh")
            .args([
                "-c",
                "IFS= read -r ignored; kill -9 \"-$1\"",
                "jackalope-process-guardian",
                &group.to_string(),
            ])
            .env_clear()
            .current_dir("/")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .map_err(|e| format!("Cannot watch the task process group: {e}"))?;
        Ok(Self {
            group,
            guardian: std::sync::Mutex::new(Some(guardian)),
        })
    }
    pub fn terminate(&self) {
        let Some(mut guardian) = self.guardian.lock().unwrap().take() else {
            return;
        };
        drop(guardian.stdin.take());
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            match guardian.try_wait() {
                Ok(Some(status)) if status.success() => return,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(5))
                }
                _ => break,
            }
        }
        unsafe {
            libc::kill(-self.group, libc::SIGKILL);
        }
        let _ = guardian.kill();
        let _ = guardian.wait();
    }
}

#[cfg(unix)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        self.terminate();
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub exit_code: Option<i32>,
    pub success: bool,
    pub timed_out: bool,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
    pub duration_ms: u64,
}

pub fn run(command: Command, timeout: Duration) -> Result<CommandResult, String> {
    run_cancellable(command, timeout, || false)
}

pub fn run_cancellable(
    command: Command,
    timeout: Duration,
    canceled: impl Fn() -> bool,
) -> Result<CommandResult, String> {
    run_cancellable_with_output(command, timeout, canceled, |_, _| {})
}

pub fn run_cancellable_with_output(
    mut command: Command,
    timeout: Duration,
    canceled: impl Fn() -> bool,
    observe: impl Fn(&[u8], bool) + Send + Sync + 'static,
) -> Result<CommandResult, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let start = Instant::now();
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start command: {e}"))?;
    let tree = match ProcessTree::attach(&child) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let stdout = child.stdout.take().ok_or("Missing command output")?;
    let stderr = child.stderr.take().ok_or("Missing command diagnostics")?;
    let observe = std::sync::Arc::new(observe);
    let observe_stdout = observe.clone();
    let out = std::thread::spawn(move || {
        read_observed(stdout, OUTPUT_LIMIT, |bytes| observe_stdout(bytes, false))
    });
    let err = std::thread::spawn(move || {
        read_observed(stderr, OUTPUT_LIMIT, |bytes| observe(bytes, true))
    });
    let (status, timed_out) = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break (status, false);
        }
        let timed_out = start.elapsed() >= timeout;
        if timed_out || canceled() {
            tree.terminate();
            let _ = child.kill();
            break (child.wait().map_err(|e| e.to_string())?, timed_out);
        }
        std::thread::sleep(Duration::from_millis(30));
    };
    tree.terminate();
    let (stdout, out_cut) = out
        .join()
        .map_err(|_| "Command output reader failed")?
        .map_err(|e| e.to_string())?;
    let (stderr, err_cut) = err
        .join()
        .map_err(|_| "Command diagnostics reader failed")?
        .map_err(|e| e.to_string())?;
    Ok(CommandResult {
        exit_code: status.code(),
        success: status.success() && !timed_out,
        timed_out,
        stdout,
        stderr,
        truncated: out_cut || err_cut,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[cfg(windows)]
    fn live_output_can_cancel_before_the_command_exits() {
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        let seen = Arc::new(AtomicBool::new(false));
        let observed = seen.clone();
        let mut command = Command::new("cmd.exe");
        command.args([
            "/D",
            "/C",
            "echo installer-progress & ping -n 30 127.0.0.1 >nul",
        ]);
        let result = run_cancellable_with_output(
            command,
            Duration::from_secs(5),
            || seen.load(Ordering::SeqCst),
            move |bytes, stderr| {
                if !stderr && !bytes.is_empty() {
                    observed.store(true, Ordering::SeqCst);
                }
            },
        )
        .unwrap();
        assert!(seen.load(Ordering::SeqCst));
        assert!(result.stdout.contains("installer-progress"));
        assert!(!result.timed_out);
        assert!(!result.success);
        assert!(result.duration_ms < 3000);
    }
    #[test]
    fn huge_lines_are_drained_without_losing_the_next_event() {
        let mut data = vec![b'x'; 1_000_000];
        data.extend_from_slice(b"\nnext\n");
        let mut lines = Vec::new();
        bounded_lines(std::io::Cursor::new(data), 100, |line, clipped| {
            lines.push((line, clipped))
        })
        .unwrap();
        assert_eq!(lines[0], ("x".repeat(100), true));
        assert_eq!(lines[1], ("next".into(), false));
    }
    #[test]
    fn output_is_bounded_and_fully_drained() {
        let (output, clipped) =
            read_bounded(std::io::Cursor::new(vec![b'x'; 1_000_000]), 100).unwrap();
        assert_eq!(output.len(), 100);
        assert!(clipped);
    }
    #[test]
    #[cfg(windows)]
    fn command_timeout_terminates_the_process_tree() {
        let mut command = Command::new("cmd.exe");
        command.args(["/D", "/C", "ping -n 30 127.0.0.1 >nul"]);
        let result = run(command, Duration::from_millis(150)).unwrap();
        assert!(result.timed_out);
        assert!(!result.success);
        assert!(result.duration_ms < 3000);
    }

    #[cfg(unix)]
    #[test]
    fn timeout_and_exit_close_descendant_pipes_without_external_kill() {
        for (script, timeout, timed_out) in [
            ("sleep 30 & wait", Duration::from_millis(150), true),
            ("sleep 30 & exit 0", Duration::from_secs(3), false),
        ] {
            let mut command = Command::new("/bin/sh");
            command.args(["-c", script]).env("PATH", "/usr/bin:/bin");
            let result = run(command, timeout).unwrap();
            assert_eq!(result.timed_out, timed_out);
            assert!(result.duration_ms < 3000);
        }
    }

    #[cfg(unix)]
    #[test]
    fn cannot_attach_to_own_process_group() {
        assert!(ProcessTree::attach_pid(unsafe { libc::getpgrp() } as u32).is_err());
        assert!(ProcessTree::attach_pid(0).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn guardian_crash_fixture() {
        if std::env::var("JACKALOPE_GUARDIAN_FIXTURE").as_deref() != Ok("1") {
            return;
        }
        use std::{io::Write, os::unix::process::CommandExt};
        let child = Command::new("/bin/sh")
            .args(["-c", "sleep 30 & wait"])
            .process_group(0)
            .spawn()
            .unwrap();
        let _tree = ProcessTree::attach(&child).unwrap();
        println!("\nguardian-ready");
        std::io::stdout().flush().unwrap();
        std::thread::sleep(Duration::from_secs(30));
    }

    #[cfg(unix)]
    #[test]
    fn abrupt_owner_death_closes_grandchild_pipes() {
        let mut owner = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "commands::process_control::tests::guardian_crash_fixture",
                "--nocapture",
            ])
            .env("JACKALOPE_GUARDIAN_FIXTURE", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        let stdout = owner.stdout.take().unwrap();
        let reader = std::thread::spawn(move || {
            for line in std::io::BufReader::new(stdout).lines() {
                if line.unwrap() == "guardian-ready" {
                    sender.send(false).unwrap();
                }
            }
            let _ = sender.send(true);
        });
        let ready = receiver.recv_timeout(Duration::from_secs(10));
        let _ = owner.kill();
        let _ = owner.wait();
        assert_eq!(
            ready,
            Ok(false),
            "fixture did not attach its process guardian"
        );
        assert_eq!(
            receiver.recv_timeout(Duration::from_secs(5)),
            Ok(true),
            "grandchildren retained the output pipe after their owner was killed"
        );
        reader.join().unwrap();
    }
}
