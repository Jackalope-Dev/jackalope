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
mod planning;
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
  jackalope                      start a conversation in this directory
  jackalope -p \"<message>\"       run once, print the reply and exit
  jackalope run \"<message>\"      the same as -p
  jackalope -c, --continue       continue the latest conversation here
  jackalope -r, --resume [id]    pick a conversation to resume, or resume by id
  jackalope ls                   list open conversations
  jackalope attach <id>          the same as --resume <id>
  jackalope stop <id>            stop the work a conversation is running
  jackalope answer <id> [reply]  show the question a conversation is waiting
                                 on, or answer it by text or option number
  jackalope diff <id> [--stat]   print a conversation's changes since it started
  jackalope merge <id>           merge a paused conversation's work into the
                                 project branch (-m <message>, --yes)
  jackalope pr <id>              commit, push and open a pull request with your
                                 GitHub CLI (--title <text>, --ready, --yes)
  jackalope plan \"<goal>\"        plan with me first: explore read-only, ask a few
                                 questions, then print a plan to approve
  jackalope plans                list this project's plans
  jackalope plan show <id>       print a plan (--json)
  jackalope plan approve <id> [single|subtasks|swarm]
                                 approve the latest revision and start it (--yes)
  jackalope status               show the host, this project and your agents
  jackalope help                 show this message

IN A CONVERSATION
  /                              pick a command: /sessions, /projects, /agent,
                                 /settings, /learn, /diff, /retry, /finish and more
  !<command>                     run a shell command in the workspace
  @<file>                        mention a file, with fuzzy completion
  Esc Esc                        stop the agent        Ctrl+R  search history
  Shift+Enter, \\ Enter, Ctrl+J   new line              Ctrl+N/P  switch conversation

STARTING A CONVERSATION
  --agent <id>                   use this agent instead of routing
  --model <id>                   use this model with the agent

RUNNING ONCE
  -p, --print                    send the message, wait, and print the reply;
                                 piped stdin is appended to the message
  --agents <a,b>                 send the message to 2 to 4 agents, each in its own
                                 workspace, and print every reply
  --json                         print the result as JSON (also for ls, status)
  --stream-json                  print one JSON line per step and output as the
                                 work moves, then the result
  --timeout <seconds>            stop waiting after this long; the work continues
  Exit status: 0 done, 1 failed or stopped, 2 an agent asked a question
  (answer it with jackalope attach <id>), 3 timed out.

OPTIONS
  --open                         start the desktop app if nothing is running
  --background                   start a headless host if nothing is running
  --init                         create a Git repository here when there is none
  --profile <dir>                use another Jackalope profile
  --version                      print the version
  --                             treat everything after as the message
";

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
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
    let init = cli.init;
    match cli.command {
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
            model,
            compare,
            json,
            stream,
            timeout,
        } => {
            announce_repository(init)?;
            let options = once::Options {
                agent,
                model,
                compare,
                json,
                stream,
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
        Command::Plan { goal, agent, json } => {
            let code = planning::start(cli.cold_start, goal, agent, json)?;
            std::process::exit(code);
        }
        Command::PlanShow { id, json } => planning::show(cli.cold_start, &id, json),
        Command::PlanApprove { id, shape, yes } => {
            planning::approve(cli.cold_start, &id, shape, yes)
        }
        Command::Plans { json } => planning::list(cli.cold_start, json),
        Command::Status { json } => subcommands::status(json),
        Command::Stop { id } => subcommands::stop(cli.cold_start, &id),
        Command::Answer { id, text } => subcommands::answer(cli.cold_start, &id, text),
        Command::Diff { id, stat } => subcommands::diff(cli.cold_start, &id, stat),
        Command::Merge { id, message, yes } => {
            subcommands::merge(cli.cold_start, &id, message, yes)
        }
        Command::PullRequest {
            id,
            title,
            ready,
            yes,
        } => subcommands::pull_request(cli.cold_start, &id, title, ready, yes),
        Command::Converse {
            resume,
            attach,
            pick,
            agent,
            model,
        } => {
            announce_repository(init)?;
            converse(
                cli.cold_start,
                attach,
                resume,
                pick,
                ui::NextStart { agent, model },
            )
        }
    }
}

fn announce_repository(init: bool) -> Result<(), String> {
    if let Some(notice) = git::prepare(init)? {
        eprintln!("{notice}");
    }
    Ok(())
}

fn converse(
    preference: Option<ColdStart>,
    attach: Option<String>,
    resume: bool,
    pick: bool,
    next: ui::NextStart,
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
                .ok_or("No conversation to continue in this directory.")?,
        ),
        None => None,
    };
    ui::run(connection, project, session_id, pick, next)
}
