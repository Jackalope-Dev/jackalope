//! Keys, scrolling and `@` mentions.

use super::commands::{slash_matches, COMMANDS};
use super::feed::Tone;
use super::pickers::PickerKind;
use super::{App, Event, FileIndex};
use crate::files;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use std::time::{Duration, Instant};

/// How long a file listing serves mentions before it is taken again, so files
/// an agent creates appear.
const FILES_FRESH: Duration = Duration::from_secs(15);

impl App {
    pub(super) fn key(&mut self, key: KeyEvent) {
        let control = key.modifiers.contains(KeyModifiers::CONTROL);
        self.selection = None;
        if key.code == KeyCode::Char('c') && control {
            // Clear what is typed, then stop commands, then leave: one key
            // never throws away more than the step before it.
            if self.picker.is_some() {
                self.picker = None;
            } else if !self.editor.is_empty() {
                self.editor.take();
                self.history_index = None;
            } else if self.interrupt_shells() > 0 {
                self.flash("Stopping commands · Ctrl+C again to leave", Tone::Warning);
            } else {
                self.quit = true;
            }
            return;
        }
        if key.code == KeyCode::Char('d') && control && self.editor.is_empty() {
            self.quit = true;
            return;
        }
        if self.picker.is_some() {
            self.picker_key(key);
            return;
        }
        let before = self.editor.text().to_string();
        self.edit(key);
        if self.editor.text() != before {
            // The menus follow the draft, so their highlight starts over.
            self.slash = 0;
        }
        self.index_files_for_mention();
    }

    fn edit(&mut self, key: KeyEvent) {
        let control = key.modifiers.contains(KeyModifiers::CONTROL);
        let alt = key.modifiers.contains(KeyModifiers::ALT);
        let shift = key.modifiers.contains(KeyModifiers::SHIFT);
        let matches = slash_matches(self.editor.text());
        let mentions = self.mention_matches();
        let working = self.working();
        let panel = self.panel_shown();
        if key.code != KeyCode::Esc {
            self.stop_armed = None;
        }
        let editor = &mut self.editor;
        match key.code {
            KeyCode::Char('l') if control => self.clear_feed(),
            KeyCode::Char('r') if control => self.open_picker(PickerKind::History),
            KeyCode::Char('z') if control => self.suspend = cfg!(unix),
            KeyCode::Char('o') if control => self.toggle_panel(),
            KeyCode::Up if (alt || shift) && panel => self.step_change(-1),
            KeyCode::Down if (alt || shift) && panel => self.step_change(1),
            // Newline without sending: Shift+Enter where the terminal reports
            // it, Alt+Enter, Ctrl+J, or a trailing backslash, which works in
            // every terminal (Windows Terminal takes Alt+Enter for full screen).
            KeyCode::Enter if alt || shift => editor.insert("\n"),
            KeyCode::Char('j') if control => editor.insert("\n"),
            KeyCode::Enter if editor.char_before() == Some('\\') => {
                editor.backspace();
                editor.insert("\n");
            }
            KeyCode::Enter | KeyCode::Tab if !mentions.is_empty() => {
                let path = mentions[self.slash.min(mentions.len() - 1)].clone();
                self.complete_mention(&path);
            }
            KeyCode::Up if !mentions.is_empty() => self.slash = self.slash.saturating_sub(1),
            KeyCode::Down if !mentions.is_empty() => {
                self.slash = (self.slash + 1).min(mentions.len() - 1)
            }
            KeyCode::Esc if !mentions.is_empty() => self.mention_closed = true,
            KeyCode::Enter if !matches.is_empty() => {
                // Run the highlighted command unless the input already names one.
                let typed = &editor.text()[1..];
                let chosen = if COMMANDS.iter().any(|(name, _)| *name == typed) {
                    typed.to_string()
                } else {
                    matches[self.slash.min(matches.len() - 1)].0.to_string()
                };
                editor.set(format!("/{chosen}"));
                self.submit();
            }
            KeyCode::Enter => self.submit(),
            KeyCode::Tab if !matches.is_empty() => {
                let name = matches[self.slash.min(matches.len() - 1)].0;
                editor.set(format!("/{name} "));
            }
            KeyCode::Esc if self.scroll_top.is_some() && editor.is_empty() => {
                self.scroll_top = None
            }
            // Esc twice stops the agent, so a stray press never does.
            KeyCode::Esc if editor.is_empty() && working => {
                if self
                    .stop_armed
                    .is_some_and(|armed| armed.elapsed() < Duration::from_secs(2))
                {
                    self.stop_armed = None;
                    self.command("stop");
                } else {
                    self.stop_armed = Some(Instant::now());
                    self.flash("Esc again to stop the agent", Tone::Warning);
                }
            }
            // Clearing is undoable: Ctrl+Y brings the draft back.
            KeyCode::Esc => editor.clear_undoably(),
            KeyCode::Up if !matches.is_empty() => self.slash = self.slash.saturating_sub(1),
            KeyCode::Down if !matches.is_empty() => {
                self.slash = (self.slash + 1).min(matches.len() - 1)
            }
            // Within a wrapped or multi-line draft, move between rows; at its
            // edges, step through history.
            KeyCode::Up => {
                if !editor.move_row(-1, self.input_width.get()) {
                    self.recall(true)
                }
            }
            KeyCode::Down => {
                if !editor.move_row(1, self.input_width.get()) {
                    self.recall(false)
                }
            }
            KeyCode::Char('n') if control => self.step_session(1),
            KeyCode::Char('p') if control => self.step_session(-1),
            KeyCode::PageUp => self.scroll(page(self.body_area.get().height)),
            KeyCode::PageDown => self.scroll(-page(self.body_area.get().height)),
            // Editing, with the shortcuts shells and editors share.
            KeyCode::Left if alt || control => editor.set_cursor(editor.word_start()),
            KeyCode::Right if alt || control => editor.set_cursor(editor.word_end()),
            KeyCode::Char('b') if alt => editor.set_cursor(editor.word_start()),
            KeyCode::Char('f') if alt => editor.set_cursor(editor.word_end()),
            KeyCode::Left => editor.set_cursor(editor.cursor().saturating_sub(1)),
            KeyCode::Right => editor.set_cursor(editor.cursor() + 1),
            KeyCode::Home if control => editor.set_cursor(0),
            KeyCode::End if control => editor.set_cursor(editor.len()),
            KeyCode::Home => editor.set_cursor(editor.line_start()),
            KeyCode::End => editor.set_cursor(editor.line_end()),
            KeyCode::Char('a') if control => editor.set_cursor(editor.line_start()),
            KeyCode::Char('e') if control => editor.set_cursor(editor.line_end()),
            KeyCode::Char('b') if control => editor.set_cursor(editor.cursor().saturating_sub(1)),
            KeyCode::Char('f') if control => editor.set_cursor(editor.cursor() + 1),
            KeyCode::Char('w') if control => editor.kill_to(editor.word_start()),
            KeyCode::Backspace if alt || control => editor.kill_to(editor.word_start()),
            KeyCode::Char('d') if alt => editor.kill_to(editor.word_end()),
            KeyCode::Delete if alt || control => editor.kill_to(editor.word_end()),
            // Ctrl+U clears to the start of the line, as shells do.
            KeyCode::Char('u') if control => editor.kill_to(editor.line_start()),
            KeyCode::Char('k') if control => editor.kill_to(editor.line_end()),
            KeyCode::Char('y') if control => editor.yank(),
            KeyCode::Backspace => editor.backspace(),
            KeyCode::Delete => editor.delete_forward(),
            KeyCode::Char(character) if !control => {
                editor.insert(&character.to_string());
                self.history_index = None;
                self.mention_closed = false;
            }
            _ => {}
        }
    }

    /// Scrolls back (positive) or forward (negative) by `lines`. Reaching the
    /// newest output follows it again.
    pub(super) fn scroll(&mut self, lines: i16) {
        if let Some(picker) = self.picker.as_mut() {
            picker.step(lines < 0);
            return;
        }
        // A selection marks screen cells, which no longer hold the same text.
        self.selection = None;
        let bottom = self.max_scroll.get();
        let top = self.scroll_top.unwrap_or(bottom).min(bottom);
        let moved = if lines > 0 {
            top.saturating_sub(lines as usize)
        } else {
            top + lines.unsigned_abs() as usize
        };
        self.scroll_top = (moved < bottom).then_some(moved);
    }

    pub(super) fn recall(&mut self, older: bool) {
        if self.history.is_empty() {
            return;
        }
        let last = self.history.len() - 1;
        let next = match (self.history_index, older) {
            (None, true) => Some(last),
            (Some(0), true) => Some(0),
            (Some(index), true) => Some(index - 1),
            (Some(index), false) if index < last => Some(index + 1),
            (_, false) => None,
        };
        self.history_index = next;
        self.editor.set(
            next.map(|index| self.history[index].clone())
                .unwrap_or_default(),
        );
    }

    /// Workspace files matching the `@` mention at the cursor, best first.
    pub(super) fn mention_matches(&self) -> Vec<String> {
        let text = self.editor.text();
        if self.mention_closed || text.starts_with('/') || text.starts_with('!') {
            return Vec::new();
        }
        let Some((_, query)) = files::mention_at(text, self.editor.cursor()) else {
            return Vec::new();
        };
        let Some(index) = &self.files else {
            return Vec::new();
        };
        let mut cache = self.mention_cache.borrow_mut();
        if let Some((cached, generation, paths)) = cache.as_ref() {
            if *cached == query && *generation == index.generation {
                return paths.clone();
            }
        }
        let paths: Vec<String> = files::matches(&index.files, &query, 8)
            .into_iter()
            .map(String::from)
            .collect();
        *cache = Some((query, index.generation, paths.clone()));
        paths
    }

    /// Lists the workspace's files in the background once a mention starts,
    /// again when the workspace changes, and again once the list is stale.
    fn index_files_for_mention(&mut self) {
        if files::mention_at(self.editor.text(), self.editor.cursor()).is_none() {
            return;
        }
        let workspace = self.workspace();
        let fresh = self.files.as_ref().is_some_and(|index| {
            index.directory == workspace && index.listed.elapsed() < FILES_FRESH
        });
        if fresh || self.indexing.as_ref() == Some(&workspace) {
            return;
        }
        self.indexing = Some(workspace.clone());
        let events = self.events.clone();
        std::thread::spawn(move || {
            let files = files::list(&workspace);
            let _ = events.send(Event::Files {
                directory: workspace,
                files,
            });
        });
    }

    pub(super) fn files_listed(&mut self, directory: String, files: Vec<String>) {
        if self.indexing.as_ref() == Some(&directory) {
            self.indexing = None;
        }
        let generation = self.files.as_ref().map_or(0, |index| index.generation + 1);
        self.files = Some(FileIndex {
            directory,
            files,
            listed: Instant::now(),
            generation,
        });
    }

    /// Replaces the mention at the cursor with `@path `.
    fn complete_mention(&mut self, path: &str) {
        let Some((start, _)) = files::mention_at(self.editor.text(), self.editor.cursor()) else {
            return;
        };
        self.editor.delete_to(start);
        // Paths with spaces are quoted so the agent reads them whole.
        if path.contains(' ') {
            self.editor.insert(&format!("@\"{path}\" "));
        } else {
            self.editor.insert(&format!("@{path} "));
        }
    }
}

/// Page Up and Page Down move most of a screen, keeping a line of context.
fn page(height: u16) -> i16 {
    height.saturating_sub(1).clamp(1, i16::MAX as u16) as i16
}
