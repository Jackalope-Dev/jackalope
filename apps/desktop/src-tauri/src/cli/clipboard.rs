//! Copying selected text. The interface captures the mouse to scroll the
//! conversation, which takes drag-selection away from the terminal, so the
//! interface selects and copies itself.

use std::io::Write;
use std::process::{Command, Stdio};

/// Puts `text` on the clipboard. Locally the platform's own tool is the most
/// reliable; over SSH only the terminal can reach the user's clipboard, via
/// OSC 52, which most current terminals accept.
pub fn copy(text: &str) -> Result<(), String> {
    let remote =
        std::env::var_os("SSH_TTY").is_some() || std::env::var_os("SSH_CONNECTION").is_some();
    if !remote && native(text) {
        return Ok(());
    }
    let mut stdout = std::io::stdout();
    write!(stdout, "\u{1b}]52;c;{}\u{7}", base64(text.as_bytes()))
        .and_then(|()| stdout.flush())
        .map_err(|error| format!("Could not copy: {error}"))
}

fn native(text: &str) -> bool {
    // `clip` reads the console code page and mangles non-ASCII text, so
    // PowerShell (told its input is UTF-8) goes first. WSL reaches the
    // Windows clipboard through `clip.exe` when no Linux tool is present.
    const POWERSHELL: &str = "[Console]::InputEncoding=[Text.Encoding]::UTF8; \
        Set-Clipboard -Value ([Console]::In.ReadToEnd())";
    let tools: &[(&str, &[&str])] = if cfg!(target_os = "macos") {
        &[("pbcopy", &[])]
    } else if cfg!(windows) {
        &[
            (
                "powershell",
                &["-NoProfile", "-NonInteractive", "-Command", POWERSHELL],
            ),
            ("clip", &[]),
        ]
    } else {
        &[
            ("wl-copy", &[]),
            ("xclip", &["-selection", "clipboard"]),
            ("xsel", &["--clipboard", "--input"]),
            ("clip.exe", &[]),
        ]
    };
    tools.iter().any(|(program, args)| {
        let Ok(mut child) = Command::new(program)
            .args(*args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        else {
            return false;
        };
        let written = child
            .stdin
            .take()
            .is_some_and(|mut stdin| stdin.write_all(text.as_bytes()).is_ok());
        child.wait().is_ok_and(|status| status.success()) && written
    })
}

fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let value = chunk.iter().enumerate().fold(0u32, |value, (index, byte)| {
            value | u32::from(*byte) << (16 - 8 * index)
        });
        for index in 0..4 {
            if index <= chunk.len() {
                out.push(ALPHABET[(value >> (18 - 6 * index) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_standard_alphabet_and_padding() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64("jackalope ⣿".as_bytes()), "amFja2Fsb3BlIOKjvw==");
    }
}
