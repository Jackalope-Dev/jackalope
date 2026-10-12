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
        /// `--agent` and `--model` for a new conversation, like `/agent` and `/model`.
        agent: Option<String>,
        model: Option<String>,
    },
    /// `-p` / `run`: one message, one reply.
    Once {
        message: String,
        agent: Option<String>,
        model: Option<String>,
        /// `--agents a,b`: the same message to each agent in its own conversation.
        compare: Vec<String>,
        json: bool,
        /// `--stream-json`: one JSON object per line as the work moves, ending
        /// with the same result `--json` prints.
        stream: bool,
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
/// The desktop compares at most four agents on one prompt.
pub const MAX_COMPARED: usize = 4;

pub fn parse(arguments: impl IntoIterator<Item = String>) -> Result<Cli, String> {
    let mut arguments = arguments.into_iter();
    let mut words: Vec<String> = Vec::new();
    let (mut print, mut json, mut resume, mut help, mut version, mut init) =
        (false, false, false, false, false, false);
    let (mut pick, mut stream) = (false, false);
    let mut cold_start = None;
    let (mut agent, mut model, mut profile, mut timeout) = (None, None, None, None);
    let mut compare: Option<Vec<String>> = None;
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
            "--stream-json" => stream = true,
            "-c" | "--continue" => resume = true,
            "-r" | "--resume" => pick = true,
            "-h" | "--help" => help = true,
            "-V" | "--version" => version = true,
            "--open" => cold_start = Some(ColdStart::Open),
            "--background" => cold_start = Some(ColdStart::Background),
            "--init" => init = true,
            "--agent" => agent = Some(value("--agent")?),
            "--model" => model = Some(value("--model")?),
            "--agents" => {
                let mut agents: Vec<String> = Vec::new();
                for agent in value("--agents")?.split(',').map(str::trim) {
                    if !agent.is_empty() && !agents.iter().any(|known| known == agent) {
                        agents.push(agent.to_string());
                    }
                }
                if !(2..=MAX_COMPARED).contains(&agents.len()) {
                    return Err(format!(
                        "--agents takes 2 to {MAX_COMPARED} different agents, as --agents claude,codex."
                    ));
                }
                compare = Some(agents);
            }
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
        if inline.is_some()
            && !matches!(
                name.as_str(),
                "--agent" | "--agents" | "--model" | "--profile" | "--timeout"
            )
        {
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
            model: model.take(),
            compare: compare.take().unwrap_or_default(),
            json: json || stream,
            stream,
            timeout,
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
            None if !resume => Command::Converse {
                resume,
                attach: None,
                pick: false,
                agent: agent.take(),
                model: model.take(),
            },
            None => Command::Converse {
                resume,
                attach: None,
                pick: false,
                agent: None,
                model: None,
            },
            Some("resume") => {
                extra(2)?;
                match argument() {
                    Some(id) => Command::Converse {
                        resume: false,
                        attach: Some(id),
                        pick: false,
                        agent: None,
                        model: None,
                    },
                    None => Command::Converse {
                        resume: false,
                        attach: None,
                        pick: true,
                        agent: None,
                        model: None,
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
                    agent: None,
                    model: None,
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
    if stream {
        match &command {
            Command::Once { compare, .. } if !compare.is_empty() => {
                return Err(format!(
                    "--stream-json follows one agent; use --json with --agents. {USAGE}"
                ));
            }
            Command::Once { .. } => {}
            _ => return Err(format!("--stream-json applies to -p. {USAGE}")),
        }
    }
    if json && !json_applies {
        return Err(format!("--json applies to -p, ls and status. {USAGE}"));
    }
    if compare.is_some() {
        return Err(format!("--agents applies to -p. {USAGE}"));
    }
    if let Command::Once {
        agent,
        model,
        compare,
        ..
    } = &command
    {
        if !compare.is_empty() && (agent.is_some() || model.is_some()) {
            return Err(format!(
                "--agents chooses the agents itself; use it without --agent or --model. {USAGE}"
            ));
        }
    }
    if agent.is_some() || model.is_some() {
        return Err(format!(
            "--agent and --model apply when starting a new conversation or -p. {USAGE}"
        ));
    }
    if timeout.is_some() && !matches!(command, Command::Once { .. }) {
        return Err(format!("--timeout applies to -p. {USAGE}"));
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
        let converse = |resume, attach: Option<&str>| Command::Converse {
            resume,
            attach: attach.map(String::from),
            pick: false,
            agent: None,
            model: None,
        };
        assert_eq!(command(&[]), converse(false, None));
        assert_eq!(command(&["-c"]), converse(true, None));
        assert_eq!(command(&["attach", "abc"]), converse(false, Some("abc")));
    }

    #[test]
    fn resume_matches_other_agent_clis() {
        let picker = Command::Converse {
            resume: false,
            attach: None,
            pick: true,
            agent: None,
            model: None,
        };
        let attach = Command::Converse {
            resume: false,
            attach: Some("ab".into()),
            pick: false,
            agent: None,
            model: None,
        };
        assert_eq!(command(&["--resume"]), picker);
        assert_eq!(command(&["-r"]), picker);
        assert_eq!(command(&["resume"]), picker);
        assert_eq!(command(&["--resume", "ab"]), attach);
        assert_eq!(command(&["resume", "ab"]), attach);
        assert!(parse_line(&["resume", "ab", "cd"]).is_err());
    }

    #[test]
    fn streamed_json_implies_json_and_follows_one_run() {
        match command(&["-p", "--stream-json", "fix", "it"]) {
            Command::Once { json, stream, .. } => assert!(json && stream),
            other => panic!("{other:?}"),
        }
        assert!(parse_line(&["ls", "--stream-json"]).is_err());
        assert!(parse_line(&["-p", "--agents", "claude,codex", "--stream-json", "x"]).is_err());
        assert!(parse_line(&["-p", "--stream-json=1", "x"]).is_err());
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
        assert!(parse_line(&["--agent=codex", "ls"]).is_err());
        assert!(parse_line(&["-c", "--model", "gpt"]).is_err());
        assert!(parse_line(&["attach", "ab", "--agent", "codex"]).is_err());
        assert!(parse_line(&["--timeout", "5"]).is_err());
        assert!(parse_line(&["attach", "--json", "x"]).is_err());
        assert!(parse_line(&["-p", "--timeout", "soon", "x"]).is_err());
        assert!(parse_line(&["ls", "extra"]).is_err());
        assert!(parse_line(&["--json=1", "ls"]).is_err());
        assert!(parse_line(&["frobnicate"]).is_err());
        assert!(parse_line(&["stop"]).is_err());
        assert!(parse_line(&["--init", "ls"]).is_err());
    }

    #[test]
    fn new_conversations_take_an_agent_and_model() {
        assert_eq!(
            command(&["--agent", "claude", "--model=opus"]),
            Command::Converse {
                resume: false,
                attach: None,
                pick: false,
                agent: Some("claude".into()),
                model: Some("opus".into()),
            }
        );
        match command(&["-p", "--model", "gpt-5", "fix it"]) {
            Command::Once { model, message, .. } => {
                assert_eq!(
                    (model.as_deref(), message.as_str()),
                    (Some("gpt-5"), "fix it")
                )
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn one_message_can_go_to_several_agents() {
        match command(&["-p", "--agents", "claude, codex,claude", "fix it"]) {
            Command::Once { compare, .. } => assert_eq!(compare, ["claude", "codex"]),
            other => panic!("{other:?}"),
        }
        assert!(parse_line(&["-p", "--agents", "claude", "x"]).is_err());
        assert!(parse_line(&["-p", "--agents=a,b,c,d,e", "x"]).is_err());
        assert!(parse_line(&["-p", "--agents=a,b", "--agent", "c", "x"]).is_err());
        assert!(parse_line(&["-p", "--agents=a,b", "--model", "m", "x"]).is_err());
        assert!(parse_line(&["--agents=a,b"]).is_err());
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
