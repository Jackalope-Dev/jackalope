use super::Progress;

#[derive(Default)]
struct Stream {
    line: Vec<u8>,
    escape: u8,
}

pub(super) struct Output {
    tool: &'static str,
    streams: [Stream; 2],
    last: Option<(String, u64, Option<u64>)>,
}

impl Output {
    pub(super) fn new(tool: &'static str) -> Self {
        Self {
            tool,
            streams: Default::default(),
            last: None,
        }
    }

    pub(super) fn consume(&mut self, bytes: &[u8], stderr: bool) -> Vec<Progress> {
        let stream = &mut self.streams[usize::from(stderr)];
        let mut lines = Vec::new();
        for &byte in bytes {
            match stream.escape {
                1 => stream.escape = if byte == b'[' { 2 } else { 0 },
                2 => {
                    if (0x40..=0x7e).contains(&byte) {
                        stream.escape = 0;
                    }
                }
                _ if byte == 0x1b => stream.escape = 1,
                _ if byte == b'\r' || byte == b'\n' => {
                    lines.push(String::from_utf8_lossy(&stream.line).trim().to_owned());
                    stream.line.clear();
                }
                _ if !byte.is_ascii_control() && stream.line.len() < 2048 => stream.line.push(byte),
                _ => {}
            }
        }
        lines
            .into_iter()
            .filter_map(|line| self.event(&line))
            .collect()
    }

    fn event(&mut self, line: &str) -> Option<Progress> {
        let lower = line.to_ascii_lowercase();
        let mut event = Progress {
            phase: "install".into(),
            ..Default::default()
        };
        if let Some((completed, total)) = download_sizes(line) {
            event.completed = completed.min(total);
            event.total = (total > 0).then_some(total);
            event.message = format!("Downloading the {} installer…", self.tool);
        } else if lower.starts_with("downloading ") {
            event.message = format!("Downloading the {} installer…", self.tool);
        } else if lower.contains("successfully verified installer hash") {
            event.message = "Download verified. Preparing installation…".into();
        } else if lower.contains("starting package install") {
            event.message = format!("Installing {}. Windows may request approval.", self.tool);
        } else if lower.contains("successfully installed") {
            event.message = "Installation complete. Checking installed tools…".into();
        } else {
            return None;
        }
        let key = (event.message.clone(), event.completed, event.total);
        if self.last.as_ref() == Some(&key) {
            return None;
        }
        self.last = Some(key);
        Some(event)
    }
}

fn download_sizes(line: &str) -> Option<(u64, u64)> {
    fn bytes(text: &str) -> Option<u64> {
        let text = text.trim();
        for (unit, scale) in [
            ("GB", 1024u64.pow(3)),
            ("MB", 1024u64.pow(2)),
            ("KB", 1024),
            ("B", 1),
        ] {
            if let Some(value) = text.strip_suffix(unit) {
                let number = value.split_whitespace().last()?.parse::<f64>().ok()?;
                return (number.is_finite() && number >= 0.0)
                    .then_some((number * scale as f64) as u64);
            }
        }
        None
    }
    let (completed, total) = line.split_once('/')?;
    Some((bytes(completed)?, bytes(total)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installer_progress_handles_split_ansi_carriage_returns_and_streams() {
        let mut output = Output::new("Ollama");
        assert!(output.consume(b"\x1b[3", false).is_empty());
        assert!(output.consume(b"2m 1.5 MB /", false).is_empty());
        assert!(output.consume(b" -\r", true).is_empty());
        let events = output.consume(b" 2 MB\x1b[0m\r", false);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].completed, 1_572_864);
        assert_eq!(events[0].total, Some(2_097_152));
        assert!(output.consume(b"1.5 MB / 2 MB\r", false).is_empty());
        let events = output.consume(b"Starting package install...\n", false);
        assert_eq!(events[0].total, None);
        assert!(events[0].message.contains("Installing Ollama"));
    }

    #[test]
    fn installer_progress_bounds_untrusted_output_and_omits_download_urls() {
        let mut output = Output::new("OpenCode");
        assert!(output.consume(&vec![b'x'; 100_000], false).is_empty());
        assert_eq!(output.streams[0].line.len(), 2048);
        assert!(output.consume(b"\n", false).is_empty());
        let events = output.consume(
            b"Downloading https://example.test/private?token=value\r\n",
            false,
        );
        assert_eq!(events[0].message, "Downloading the OpenCode installer…");
        assert_eq!(output.consume(b"Successfully installed\n", false).len(), 1);
    }
}
