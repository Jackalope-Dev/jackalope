//! The `jackalope` command.
//!
//! A thin client. The profile has exactly one owner — the desktop process
//! holds exclusive locks on it — so this never opens the profile itself; it
//! attaches to the running host, or offers to start one.

mod args;
mod brand;
mod clipboard;
mod connection;
mod files;
mod git;
mod history;
mod host;
mod once;
mod prefs;
mod protocol;
mod shell;
mod subcommands;
mod ui;

use args::Command;
use host::ColdStart;
use std::io::IsTerminal;

const HELP: &str = "\
jackalope — talk to your agents from the terminal

USAGE
  jackalope                      start a conversation in this repository
  jackalope -p \"<message>\"       run once, print the reply and exit
  jackalope run \"<message>\"      the same as -p
  jackalope -c, --continue       continue the latest conversation here
  jackalope -r, --resume [id]    pick a conversation to resume, or resume by id
  jackalope ls                   list open conversations
  jackalope attach <id>          the same as --resume <id>
  jackalope stop <id>            stop the work a conversation is running
  jackalope status               show the host, this project and your agents
  jackalope help                 show this message

IN A CONVERSATION
  /                              pick a command: /sessions, /projects, /agent,
                                 /settings, /learn, /diff, /retry, /finish and more
  !<command>                     run a shell command in the workspace
  @<file>                        mention a file, with fuzzy completion
  Esc Esc                        stop the agent        Ctrl+R  search history
  Shift+Enter, \\ Enter, Ctrl+J   new line              Ctrl+N/P  switch conversation

RUNNING ONCE
  -p, --print                    send the message, wait, and print the reply;
                                 piped stdin is appended to the message
  --json                         print the result as JSON (also for ls, status)
  --agent <id>                   use this agent instead of routing
  --timeout <seconds>            stop waiting after this long; the work continues
  Exit status: 0 done, 1 failed or stopped, 2 an agent asked a question
  (answer it with jackalope attach <id>), 3 timed out.

OPTIONS
  --open                         start the desktop app if nothing is running
  --background                   start a headless host if nothing is running
  --profile <dir>                use another Jackalope profile
  --version                      print the version
  --                             treat everything after as the message
";

fn main() {
    let cli = match args::parse(std::env::args().skip(1)) {
        Ok(cli) => cli,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(64);
        }
    };
    if let Some(directory) = &cli.profile {
        std::env::set_var("JACKALOPE_PROFILE_DIR", directory);
    }
    let result = match cli.command {
        Command::Help => {
            print!("{HELP}");
            Ok(())
        }
        Command::Version => {
            println!("jackalope {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        Command::Once {
            message,
            agent,
            json,
            timeout,
        } => {
            let options = once::Options {
                agent,
                json,
                timeout,
                cold_start: cli.cold_start,
            };
            let code = once::run(message, options).unwrap_or_else(|error| {
                eprintln!("{error}");
                1
            });
            std::process::exit(code);
        }
        Command::List { json } => subcommands::list(cli.cold_start, json),
        Command::Status { json } => subcommands::status(json),
        Command::Stop { id } => subcommands::stop(cli.cold_start, &id),
        Command::Converse {
            resume,
            attach,
            pick,
        } => converse(cli.cold_start, attach, resume, pick),
    };
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn converse(
    preference: Option<ColdStart>,
    attach: Option<String>,
    resume: bool,
    pick: bool,
) -> Result<(), String> {
    if !std::io::stdout().is_terminal() {
        return Err("The conversation needs an interactive terminal.".into());
    }
    let mut connection = host::ensure(preference)?;
    let project = subcommands::here(&mut connection)?;
    brand::set_accent(project.accent.as_deref());
    let session_id = match attach {
        Some(prefix) => Some(connection::resolve(&connection.sessions()?, &prefix)?),
        None if resume => Some(
            subcommands::latest(&mut connection, &project)?
                .ok_or("No conversation to continue in this repository.")?,
        ),
        None => None,
    };
    ui::run(connection, project, session_id, pick)
}
