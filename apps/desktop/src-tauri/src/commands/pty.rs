use portable_pty::{Child, MasterPty};

/// A process running in a pseudo-terminal, with the handles needed to write to,
/// resize and stop it.
pub struct PtySession {
    pub writer: Box<dyn std::io::Write + Send>,
    pub master: Box<dyn MasterPty + Send>,
    pub child: Box<dyn Child + Send + Sync>,
    pub tree: Option<super::process_control::ProcessTree>,
}

impl PtySession {
    pub fn stop(&mut self) -> std::io::Result<()> {
        if let Some(tree) = &self.tree {
            tree.terminate();
        }
        if self.child.try_wait()?.is_none() {
            let killed = self.child.kill();
            if killed.is_err() && self.child.try_wait()?.is_none() {
                killed?;
            }
        }
        self.child.wait()?;
        Ok(())
    }
}

/// Splits off the longest valid-UTF-8 prefix of `bytes`, returning it
/// alongside whatever trailing bytes remain undecoded (the start of a
/// multi-byte sequence that isn't complete yet). A carry-over larger than
/// 4 bytes (the longest possible UTF-8 sequence) means those bytes are
/// genuinely malformed, not just incomplete — lossy-decode and drop them
/// rather than buffering invalid data forever.
pub(super) fn split_valid_utf8_prefix(bytes: &[u8]) -> (String, Vec<u8>) {
    match std::str::from_utf8(bytes) {
        Ok(valid) => (valid.to_string(), Vec::new()),
        Err(error) => {
            let valid_up_to = error.valid_up_to();
            let (valid, rest) = bytes.split_at(valid_up_to);
            // Safe: `valid_up_to` is exactly the length of the longest valid
            // UTF-8 prefix, guaranteed by `Utf8Error`'s contract.
            let valid = std::str::from_utf8(valid).unwrap();
            if rest.len() > 4 {
                let mut combined = valid.to_string();
                combined.push_str(&String::from_utf8_lossy(rest));
                (combined, Vec::new())
            } else {
                (valid.to_string(), rest.to_vec())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    //! Exercises the portable-pty APIs the work terminal and agent sign-in use
    //! on this machine's backend (ConPTY on Windows).
    use super::{split_valid_utf8_prefix, PtySession};
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::{Read, Write};
    use std::time::{Duration, Instant};

    #[test]
    fn spawns_a_real_process_in_a_pty_and_reads_its_output() {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("failed to allocate a pty");

        #[cfg(windows)]
        let mut cmd = CommandBuilder::new("cmd.exe");
        #[cfg(windows)]
        cmd.args(["/C", "echo hello-from-pty"]);

        #[cfg(not(windows))]
        let mut cmd = CommandBuilder::new("/bin/sh");
        #[cfg(not(windows))]
        cmd.args(["-c", "echo hello-from-pty"]);

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .expect("failed to spawn command in pty");
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .expect("failed to clone pty reader");

        let mut writer = pair
            .master
            .take_writer()
            .expect("failed to take pty writer");
        let (send, receive) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(count) = reader.read(&mut buf) {
                if count == 0 || send.send(buf[..count].to_vec()).is_err() {
                    break;
                }
            }
        });

        let mut output = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut cursor_reported = false;
        while let Ok(chunk) =
            receive.recv_timeout(deadline.saturating_duration_since(Instant::now()))
        {
            output.extend_from_slice(&chunk);
            let text = String::from_utf8_lossy(&output);
            if !cursor_reported && text.contains("\u{1b}[6n") {
                writer.write_all(b"\x1b[1;1R").unwrap();
                cursor_reported = true;
            }
            if text.contains("hello-from-pty") {
                break;
            }
        }

        let _ = child.kill();
        let _ = child.wait();
        let text = String::from_utf8_lossy(&output);
        assert!(
            text.contains("hello-from-pty"),
            "expected pty output to contain the echoed string, got: {text:?}"
        );
    }

    #[test]
    fn utf8_prefix_reconstructs_a_multibyte_character_split_across_every_possible_boundary() {
        // A pty read boundary can land anywhere, including mid-character.
        // "🦊" is 4 bytes (F0 9F A6 8A); verify every way of splitting
        // "hi 🦊 fox" across two chunks still reconstructs the full string
        // once both chunks are fed through, not two replacement characters.
        let full = "hi 🦊 fox".as_bytes();
        for split_at in 1..full.len() {
            let (first, second) = full.split_at(split_at);
            let (chunk1, carry) = split_valid_utf8_prefix(first);
            let mut combined = Vec::from(carry);
            combined.extend_from_slice(second);
            let (chunk2, carry2) = split_valid_utf8_prefix(&combined);
            assert!(
                carry2.is_empty(),
                "split_at={split_at} left a dangling carry"
            );
            assert_eq!(
                format!("{chunk1}{chunk2}"),
                "hi 🦊 fox",
                "split_at={split_at} corrupted the character instead of buffering it"
            );
        }
    }

    #[test]
    fn utf8_prefix_passes_through_plain_ascii_unchanged() {
        let (chunk, carry) = split_valid_utf8_prefix(b"plain ascii output\n");
        assert_eq!(chunk, "plain ascii output\n");
        assert!(carry.is_empty());
    }

    #[test]
    fn utf8_prefix_does_not_buffer_genuinely_invalid_bytes_forever() {
        // 0xFF is not a valid UTF-8 lead byte under any continuation — this
        // must get lossily decoded and dropped, not held as "incomplete"
        // forever (which would silently swallow all output after it).
        let (chunk, carry) = split_valid_utf8_prefix(&[b'o', b'k', 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
        assert!(carry.is_empty());
        assert!(chunk.starts_with("ok"));
    }

    fn process_is_alive(pid: u32) -> bool {
        #[cfg(windows)]
        {
            let output = std::process::Command::new("tasklist")
                .args(["/FI", &format!("PID eq {pid}"), "/NH"])
                .output()
                .expect("failed to run tasklist");
            String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())
        }
        #[cfg(not(windows))]
        {
            std::process::Command::new("kill")
                .args(["-0", &pid.to_string()])
                .status()
                .is_ok_and(|status| status.success())
        }
    }

    /// Checks the OS process itself, not only the handle.
    #[test]
    fn stop_terminates_the_real_child_process() {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("failed to allocate a pty");

        #[cfg(windows)]
        let mut cmd = CommandBuilder::new("cmd.exe");
        #[cfg(windows)]
        cmd.args(["/C", "ping", "-t", "127.0.0.1"]);
        #[cfg(not(windows))]
        let mut cmd = CommandBuilder::new("sleep");
        #[cfg(not(windows))]
        cmd.arg("30");

        let child = pair
            .slave
            .spawn_command(cmd)
            .expect("failed to spawn command in pty");
        drop(pair.slave);
        let pid = child.process_id().expect("spawned child has no pid");
        let tree = crate::commands::process_control::ProcessTree::attach_pid(pid).unwrap();
        let writer = pair
            .master
            .take_writer()
            .expect("failed to take pty writer");

        let mut session = PtySession {
            writer,
            master: pair.master,
            child,
            tree: Some(tree),
        };
        assert!(
            process_is_alive(pid),
            "process should be running before kill"
        );

        let _ = session.stop();

        let deadline = Instant::now() + Duration::from_secs(5);
        while process_is_alive(pid) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(
            !process_is_alive(pid),
            "process should be killed, not orphaned"
        );
    }
}
