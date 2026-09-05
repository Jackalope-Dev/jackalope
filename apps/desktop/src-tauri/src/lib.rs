pub mod commands;
pub mod state;

use commands::{agent::*, git::*, pty::*, system::*};
use state::AppState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            git_list_worktrees,
            git_create_worktree,
            agent_spawn_process,
            system_get_info,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running jackalope application");
}
