// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use jackalope_lib::cli_protocol::{attach, Request, Response};

fn main() {
    let headless = std::env::args()
        .skip(1)
        .any(|argument| argument == "--headless");

    // A profile has exactly one owner — `TaskRuntime` and `Coordinator` both
    // take exclusive locks — so launching again must reach the running process
    // rather than start a rival one the lock would refuse anyway.
    if let Some((_, mut client)) = attach() {
        if headless {
            // A host is already serving this profile; nothing left to start.
            return;
        }
        match client.send(&Request::ShowWindow) {
            Ok(Response::Ok) => return,
            Ok(Response::Error { message }) => {
                eprintln!("Jackalope is running but could not open its window: {message}");
                std::process::exit(1);
            }
            Ok(_) => {
                eprintln!("Jackalope is running but answered unexpectedly.");
                std::process::exit(1);
            }
            Err(error) => {
                eprintln!("Jackalope is running but did not respond: {error}");
                std::process::exit(1);
            }
        }
    }

    jackalope_lib::run(jackalope_lib::Launch { headless });
}
