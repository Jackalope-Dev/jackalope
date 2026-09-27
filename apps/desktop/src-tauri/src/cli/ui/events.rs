//! The event loop and the threads that feed it.

use super::pickers::PickerKind;
use super::{render, App, Event, Overview};
use crate::connection::{unexpected, Connection};
use crate::protocol::{Handshake, Request, Response};
use crossterm::event::{self, Event as TermEvent, KeyEventKind, MouseButton, MouseEventKind};
use std::sync::mpsc::{Receiver, Sender};
use std::time::Duration;

/// How long a status-line confirmation stays.
const FLASH: Duration = Duration::from_millis(2500);

pub fn event_loop(
    terminal: &mut ratatui::DefaultTerminal,
    app: &mut App,
    inbox: &Receiver<Event>,
    enhanced: bool,
) -> Result<(), String> {
    // Set when the desktop app started this terminal; it asks which
    // conversation is showing here when the user moves it elsewhere.
    let key = std::env::var("JACKALOPE_TERMINAL").ok();
    let mut reported: Option<Option<String>> = None;
    let mut redraw = true;
    while !app.quit {
        if let Some(key) = &key {
            if reported.as_ref() != Some(&app.session) {
                let _ = app.connection.send(&Request::Attached {
                    terminal: key.clone(),
                    session_id: app.session.clone(),
                });
                reported = Some(app.session.clone());
            }
        }
        #[cfg(unix)]
        if std::mem::take(&mut app.suspend) {
            super::suspend(terminal, enhanced)?;
            redraw = true;
        }
        // Windows has no job control; Ctrl+Z is ignored there.
        #[cfg(not(unix))]
        let _ = (enhanced, std::mem::take(&mut app.suspend));
        if redraw {
            app.signal();
            let drawn = terminal
                .draw(|frame| render::draw(frame, app))
                .map_err(|error| error.to_string())?;
            // Only a selection copies from the screen.
            app.screen = app.selection.map(|_| drawn.buffer.clone());
        }
        // Wait for one event, then take everything else already queued, so a
        // burst of output or keys costs one frame.
        let first = inbox
            .recv()
            .map_err(|_| "Lost the terminal input stream.".to_string())?;
        redraw = handle(app, first);
        while let Ok(next) = inbox.try_recv() {
            redraw |= handle(app, next);
            if app.quit {
                break;
            }
        }
    }
    Ok(())
}

/// Applies one event, returning whether the screen needs drawing again.
fn handle(app: &mut App, event: Event) -> bool {
    match event {
        Event::Key(key) => app.key(key),
        Event::Select(mouse) => app.select(mouse),
        Event::Shell(update) => app.shell_update(update),
        Event::Changed => {
            app.refresh();
            return false;
        }
        Event::Snapshot(snapshot) => app.apply(*snapshot),
        Event::Overview(overview) => {
            app.overview = Some(overview);
            if app.picker.as_ref().map(|picker| picker.kind) == Some(PickerKind::Agents) {
                app.open_picker(PickerKind::Agents);
            }
        }
        Event::Files { directory, files } => app.files_listed(directory, files),
        Event::Resize => {}
        Event::Scroll(lines) => app.scroll(lines),
        Event::Paste(text) => {
            if app.picker.is_none() {
                // Normalise pasted line endings; keep the text multi-line.
                app.editor
                    .insert(&text.replace("\r\n", "\n").replace('\r', "\n"));
            }
        }
        Event::Tick => {
            let tip_changed = app.rotate_tip_if_elapsed();
            let flash_expired = app
                .flash
                .as_ref()
                .is_some_and(|(_, _, at)| at.elapsed() >= FLASH);
            if flash_expired {
                app.flash = None;
            }
            // Only moving indicators, a tip or an expiring flash need a redraw.
            if !app.animating() && !tip_changed && !flash_expired {
                return false;
            }
            app.tick = app.tick.wrapping_add(1);
        }
    }
    true
}

pub fn spawn_input(events: Sender<Event>) {
    std::thread::spawn(move || loop {
        let forwarded = match event::read() {
            // Windows reports releases too; acting on them would double every key.
            Ok(TermEvent::Key(key)) if key.kind == KeyEventKind::Press => {
                events.send(Event::Key(key))
            }
            Ok(TermEvent::Resize(_, _)) => events.send(Event::Resize),
            Ok(TermEvent::Paste(text)) => events.send(Event::Paste(text)),
            Ok(TermEvent::Mouse(mouse)) => match mouse.kind {
                MouseEventKind::ScrollUp => events.send(Event::Scroll(3)),
                MouseEventKind::ScrollDown => events.send(Event::Scroll(-3)),
                MouseEventKind::Down(MouseButton::Left)
                | MouseEventKind::Drag(MouseButton::Left)
                | MouseEventKind::Up(MouseButton::Left) => events.send(Event::Select(mouse)),
                _ => Ok(()),
            },
            Ok(_) => Ok(()),
            Err(_) => return,
        };
        if forwarded.is_err() {
            return;
        }
    });
}

/// Holds a connection of its own on `watch`, which blocks until work changes.
/// The connection finds a restarted host itself; this only paces retries.
pub fn spawn_watcher(handshake: Handshake, events: Sender<Event>) {
    std::thread::spawn(move || {
        let mut connection = Connection::lazy(handshake);
        let mut since = 0;
        loop {
            match connection.watch(since) {
                Ok(revision) if revision != since => {
                    since = revision;
                    if events.send(Event::Changed).is_err() {
                        return;
                    }
                }
                Ok(_) => {}
                Err(_) => {
                    // Losing the host is itself news: the refresh reports it.
                    if events.send(Event::Changed).is_err() {
                        return;
                    }
                    std::thread::sleep(Duration::from_secs(2));
                }
            }
        }
    });
}

/// Drives the working indicator. Cheap when idle: the loop skips redraws unless
/// something moves.
pub fn spawn_ticker(events: Sender<Event>) {
    std::thread::spawn(move || {
        while events.send(Event::Tick).is_ok() {
            std::thread::sleep(Duration::from_millis(120));
        }
    });
}

/// Asks for the agent overview on its own connection: the host probes each
/// agent's sign-in, which can take seconds, and the UI must stay responsive.
pub fn spawn_overview(handshake: Handshake, events: Sender<Event>) {
    std::thread::spawn(move || {
        let mut connection = Connection::lazy(handshake);
        let result = match connection.call(&Request::Overview) {
            Ok(Response::Overview {
                agents,
                default_agent,
            }) => Ok(Overview {
                agents,
                default_agent,
            }),
            Ok(_) => Err(unexpected()),
            Err(message) => Err(message),
        };
        let _ = events.send(Event::Overview(result));
    });
}

impl App {
    /// Rotates to the next tip every 8 seconds, returning true when changed.
    fn rotate_tip_if_elapsed(&mut self) -> bool {
        if self.last_tip_change.elapsed() >= Duration::from_secs(8) {
            self.tip_index = (self.tip_index + 1) % render::TIPS.len();
            self.last_tip_change = std::time::Instant::now();
            true
        } else {
            false
        }
    }
}
