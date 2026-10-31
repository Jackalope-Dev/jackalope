//! `/sharpen`: rewrites a draft into a deeper version of the same task and
//! puts it back in the input to edit. It never sends.

use super::feed::Tone;
use super::{App, Event};
use crate::connection::{unexpected, Connection};
use crate::protocol::{Request, Response};

/// A finished rewrite, kept until it is edited or undone.
pub(super) struct Sharpened {
    pub original: String,
    pub rewritten: String,
}

impl App {
    pub(super) fn sharpen(&mut self, argument: &str) {
        if argument == "undo" {
            self.unsharpen();
            return;
        }
        if argument.is_empty() {
            self.note("Add the draft: /sharpen <what to do>. The rewrite comes back here to edit.");
            return;
        }
        if self.sharpening {
            self.flash("Already sharpening a draft", Tone::Muted);
            return;
        }
        self.sharpening = true;
        self.note("Sharpening your draft…");
        let original = argument.to_string();
        let request = Request::Sharpen {
            text: original.clone(),
            project_id: Some(self.project.id.clone()),
            project_name: Some(self.project.name.clone()),
        };
        let handshake = self.handshake.clone();
        let events = self.events.clone();
        // On a connection of its own: a rewrite can take a minute and the
        // terminal must stay usable meanwhile.
        std::thread::spawn(move || {
            let result = match Connection::lazy(handshake).call(&request) {
                Ok(Response::Sharpened { text }) => Ok(text),
                Ok(_) => Err(unexpected()),
                Err(message) => Err(message),
            };
            let _ = events.send(Event::Sharpened { original, result });
        });
    }

    pub(super) fn sharpened(&mut self, original: String, result: Result<String, String>) {
        self.sharpening = false;
        let rewritten = match result {
            Ok(rewritten) => rewritten,
            Err(message) => {
                self.note_tone(format!("Could not sharpen: {message}"), Tone::Warning);
                if self.editor.is_empty() {
                    self.editor.set(original);
                }
                return;
            }
        };
        if self.editor.is_empty() {
            self.editor.set(rewritten.clone());
            self.note_tone(
                "Sharpened · edit it and press Enter to send. Esc, then /sharpen undo, brings back your draft.",
                Tone::Success,
            );
        } else {
            // Never overwrite what was typed meanwhile.
            self.note(format!("Sharpened draft:\n{rewritten}"));
        }
        self.sharpen_undo = Some(Sharpened {
            original,
            rewritten,
        });
    }

    fn unsharpen(&mut self) {
        let Some(Sharpened {
            original,
            rewritten,
        }) = self.sharpen_undo.take()
        else {
            self.flash("Nothing to undo", Tone::Muted);
            return;
        };
        if !self.editor.is_empty() && self.editor.text() != rewritten {
            self.note(format!("Your draft before sharpening:\n{original}"));
            return;
        }
        self.editor.set(original);
        self.flash("Brought back your draft", Tone::Muted);
    }
}
