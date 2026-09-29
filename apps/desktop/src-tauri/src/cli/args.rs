//! The command line, parsed into what to do.

use crate::host::ColdStart;
use std::time::Duration;

#[derive(Debug, PartialEq)]
pub enum Command {
    /// The interactive conversation: a new one, the latest here, or one by id.
    Converse {
        resume: bool,
        attach: Option<String>,
        /// Open the conversation picker first (`--resume` without an id).
        pick: bool,
    },
    /// `-p` / `run`: one message, one reply.
    Once {
        message: String,
        agent: Option<String>,
        json: bool,
        timeout: Option<Duration>,
    },
    List {
        json: bool,
    },
    Status {
        json: bool,
    },
    Stop {
        id: String,
    },
    Help,
    Version,
}

#[derive(Debug, PartialEq)]
pub struct Cli {
    pub command: Command,
    pub cold_start: Option<ColdStart>,
    /// `--profile=<dir>`, which the app passes when opening a system terminal,
    /// since a terminal that is already running will not inherit its environment.
    pub profile: Option<String>,
    /// `--init`: create a repository in the current directory when it has none.
    pub init: bool,
}

const USAGE: &str = "Run 'jackalope help' to see what is available.";

pub fn parse(arguments: impl IntoIterator<Item = String>) -> Result<Cli, String> {
    let mut arguments = arguments.into_iter();
    let mut words: Vec<String> = Vec::new();
    let (mut print, mut json, mut resume, mut help, mut version, mut init) =
        (false, false, false, false, false, false);
    let mut pick = false;
    let mut cold_start = None;
    let (mut agent, mut profile, mut timeout) = (None, None, None);
    let mut only_words = false;
    while let Some(argument) = arguments.next() {
        // Anything after `--`, a lone `-`, and text with spaces (a quoted
        // message such as "-v is broken") are words, never options.
        if only_words || !argument.starts_with('-') || argument == "-" || argument.contains(' ') {
            words.push(argument);
            continue;
        }
        let (name, inline) = match argument.split_once('=') {
            Some((name, value)) => (name.to_string(), Some(value.to_string())),
            None => (argument.clone(), None),
        };
        let mut value = |name: &str| -> Result<String, String> {
            inline
                .clone()
                .or_else(|| arguments.next())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| format!("{name} needs a value. {USAGE}"))
        };
        match name.as_str() {
            "--" => only_words = true,
            "-p" | "--print" => print = true,
            "--json" => json = true,
            "-c" | "--continue" => resume = true,
            "-r" | "--resume" => pick = true,
            "-h" | "--help" => help = true,
            "-V" | "--version" => version = true,
            "--open" => cold_start = Some(ColdStart::Open),
            "--background" => cold_start = Some(ColdStart::Background),
            "--init" => init = true,
            "--agent" => agent = Some(value("--agent")?),
            "--profile" => profile = Some(value("--profile")?),
            "--timeout" => {
                let text = value("--timeout")?;
                let seconds: u64 = text
                    .parse()
                    .map_err(|_| format!("--timeout takes a number of seconds, not '{text}'."))?;
                timeout = Some(Duration::from_secs(seconds));
            }
            _ => return Err(format!("Unknown option '{argument}'. {USAGE}")),
        }
        if inline.is_some() && !matches!(name.as_str(), "--agent" | "--profile" | "--timeout") {
            return Err(format!("{name} does not take a value. {USAGE}"));
        }
    }

    // `--resume [id]` reads like Claude Code and Codex: the same as `resume [id]`.
    if pick && words.first().map(String::as_str) != Some("resume") {
        words.insert(0, "resume".into());
    }
    let first = words.first().map(String::as_str);
    let command = if help || (!print && first == Some("help")) {
        Command::Help
    } else if version {
        Command::Version
    } else if print || first == Some("run") {
        let skip = usize::from(!print);
        Command::Once {
            message: words[skip.min(words.len())..].join(" "),
            agent: agent.take(),
            json,
            timeout: timeout.take(),
        }
    } else {
        let argument = || words.get(1).cloned();
        let extra = |taken: usize| {
            words
                .get(taken)
                .map(|word| Err(format!("Unexpected '{word}'. {USAGE}")))
                .unwrap_or(Ok(()))
        };
        match first {
            None => Command::Converse {
                resume,
                attach: None,
                pick: false,
            },
            Some("resume") => {
                extra(2)?;
                match argument() {
                    Some(id) => Command::Converse {
                        resume: false,
                        attach: Some(id),
                        pick: false,
                    },
                    None => Command::Converse {
                        resume: false,
                        attach: None,
                        pick: true,
                    },
                }
            }
            Some("ls" | "sessions") => {
                extra(1)?;
                Command::List { json }
            }
            Some("status") => {
                extra(1)?;
                Command::Status { json }
            }
            Some("attach") => {
                extra(2)?;
                Command::Converse {
                    resume: false,
                    attach: Some(
                        argument().ok_or("Which conversation? Run 'jackalope ls' to see them.")?,
                    ),
                    pick: false,
                }
            }
            Some("stop") => {
                extra(2)?;
                Command::Stop {
                    id: argument().ok_or("Which conversation? Run 'jackalope ls' to see them.")?,
                }
            }
            Some(other) => {
                return Err(format!("Unknown command '{other}'. {USAGE}"));
            }
        }
    };

    let json_applies = matches!(
        command,
        Command::Once { .. } | Command::List { .. } | Command::Status { .. }
    );
    if json && !json_applies {
        return Err(format!("--json applies to -p, ls and status. {USAGE}"));
    }
    if agent.is_some() || timeout.is_some() {
        return Err(format!("--agent and --timeout apply to -p. {USAGE}"));
    }
    if resume && !matches!(command, Command::Converse { attach: None, .. }) {
        return Err(format!("--continue starts the conversation view. {USAGE}"));
    }
    if init
        && !matches!(
            command,
            Command::Converse { .. } | Command::Once { .. } | Command::Help | Command::Version
        )
    {
        return Err(format!(
            "--init applies when starting a conversation. {USAGE}"
        ));
    }
    Ok(Cli {
        command,
        cold_start,
        profile,
        init,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_line(line: &[&str]) -> Result<Cli, String> {
        parse(line.iter().map(|word| word.to_string()))
    }

    fn command(line: &[&str]) -> Command {
        parse_line(line).unwrap().command
    }

    #[test]
    fn a_bare_command_opens_the_conversation() {
        assert_eq!(
            command(&[]),
            Command::Converse {
                resume: false,
                attach: None,
                pick: false
            }
        );
        assert_eq!(
            command(&["-c"]),
            Command::Converse {
                resume: true,
                attach: None,
                pick: false
            }
        );
        assert_eq!(
            command(&["attach", "abc"]),
            Command::Converse {
                resume: false,
                attach: Some("abc".into()),
                pick: false
            }
        );
    }

    #[test]
    fn resume_matches_other_agent_clis() {
        let picker = Command::Converse {
            resume: false,
            attach: None,
            pick: true,
        };
        let attach = Command::Converse {
            resume: false,
            attach: Some("ab".into()),
            pick: false,
        };
        assert_eq!(command(&["--resume"]), picker);
        assert_eq!(command(&["-r"]), picker);
        assert_eq!(command(&["resume"]), picker);
        assert_eq!(command(&["--resume", "ab"]), attach);
        assert_eq!(command(&["resume", "ab"]), attach);
        assert!(parse_line(&["resume", "ab", "cd"]).is_err());
    }

    #[test]
    fn options_take_values_either_way() {
        let once = |line: &[&str]| match command(line) {
            Command::Once {
                message,
                agent,
                timeout,
                ..
            } => (message, agent, timeout),
            other => panic!("{other:?}"),
        };
        assert_eq!(
            once(&["-p", "--agent", "codex", "fix", "it"]),
            ("fix it".into(), Some("codex".into()), None)
        );
        assert_eq!(
            once(&["run", "--agent=codex", "--timeout", "30", "fix"]),
            (
                "fix".into(),
                Some("codex".into()),
                Some(Duration::from_secs(30))
            )
        );
        let cli = parse_line(&["--profile", "/tmp/p", "status"]).unwrap();
        assert_eq!(cli.profile.as_deref(), Some("/tmp/p"));
        assert_eq!(cli.command, Command::Status { json: false });
    }

    #[test]
    fn messages_that_look_like_options_are_kept() {
        let message = |line: &[&str]| match command(line) {
            Command::Once { message, .. } => message,
            other => panic!("{other:?}"),
        };
        assert_eq!(message(&["-p", "-v is broken"]), "-v is broken");
        assert_eq!(message(&["-p", "--", "-v", "-q"]), "-v -q");
        assert_eq!(message(&["-p", "run", "the", "tests"]), "run the tests");
    }

    #[test]
    fn mistakes_are_reported_instead_of_ignored() {
        assert!(parse_line(&["-p", "--jsn", "x"]).is_err());
        assert!(parse_line(&["--agent"]).is_err());
        assert!(parse_line(&["--agent=codex"]).is_err());
        assert!(parse_line(&["attach", "--json", "x"]).is_err());
        assert!(parse_line(&["-p", "--timeout", "soon", "x"]).is_err());
        assert!(parse_line(&["ls", "extra"]).is_err());
        assert!(parse_line(&["--json=1", "ls"]).is_err());
        assert!(parse_line(&["frobnicate"]).is_err());
        assert!(parse_line(&["stop"]).is_err());
        assert!(parse_line(&["--init", "ls"]).is_err());
    }

    #[test]
    fn init_applies_to_starting_a_conversation() {
        assert!(parse_line(&["--init"]).unwrap().init);
        assert!(parse_line(&["-p", "--init", "fix it"]).unwrap().init);
        assert!(!parse_line(&["-p", "fix it"]).unwrap().init);
    }

    #[test]
    fn help_and_version_win() {
        assert_eq!(command(&["help"]), Command::Help);
        assert_eq!(command(&["ls", "--help"]), Command::Help);
        assert_eq!(command(&["-V"]), Command::Version);
        assert_eq!(command(&["ls", "--json"]), Command::List { json: true });
        assert_eq!(command(&["stop", "ab"]), Command::Stop { id: "ab".into() });
    }
}
