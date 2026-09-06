use std::{
    io::{BufRead, Read},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

pub const OUTPUT_LIMIT: usize = 128_000;

pub fn read_bounded(mut reader: impl Read, limit: usize) -> std::io::Result<(String, bool)> {
    let mut kept = Vec::new();
    let mut buffer = [0; 8192];
    let mut truncated = false;
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
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
        use std::os::windows::io::{AsRawHandle, FromRawHandle};
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
                || AssignProcessToJobObject(handle, child.as_raw_handle()) == 0
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

#[cfg(not(windows))]
pub struct ProcessTree(u32);

#[cfg(not(windows))]
impl ProcessTree {
    pub fn attach(child: &Child) -> Result<Self, String> {
        Ok(Self(child.id()))
    }
    pub fn terminate(&self) {
        let _ = Command::new("kill")
            .args(["-KILL", "--", &format!("-{}", self.0)])
            .output();
    }
}

#[cfg(not(windows))]
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
    mut command: Command,
    timeout: Duration,
    canceled: impl Fn() -> bool,
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
    let out = std::thread::spawn(move || read_bounded(stdout, OUTPUT_LIMIT));
    let err = std::thread::spawn(move || read_bounded(stderr, OUTPUT_LIMIT));
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
}
