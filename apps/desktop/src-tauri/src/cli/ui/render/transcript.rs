//! The transcript: the conversation, then Jackalope's own feed below it.
//!
//! Rows are measured with the same word wrapping the frame draws with, so the
//! view can pin to the newest output exactly. The conversation part only
//! changes when the host reports new state, so its lines and their heights are
//! cached; the feed (notes, `!` output, spinners) is rebuilt each frame. Only
//! the lines in view are handed to the frame.

use super::markdown::markdown;
use super::{duration, welcome};
use crate::brand;
use crate::protocol::{self, SessionView};
use crate::shell;
use crate::ui::feed::Entry;
use crate::ui::App;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Wrap};

/// Output lines shown for a command; a running one shows its tail as it
/// streams. `/copy` and selection reach anything still on screen.
const SHELL_TAIL: usize = 40;

/// Lines with the rows each takes once wrapped to a width.
pub struct Measured {
    lines: Vec<Line<'static>>,
    heights: Vec<usize>,
    total: usize,
}

impl Measured {
    pub fn new(lines: Vec<Line<'static>>, width: u16) -> Self {
        let heights: Vec<usize> = lines.iter().map(|line| rows(line, width)).collect();
        let total = heights.iter().sum();
        Self {
            lines,
            heights,
            total,
        }
    }
}

/// Rows `line` fills at `width`, wrapped exactly as the frame wraps it.
fn rows(line: &Line<'static>, width: u16) -> usize {
    Paragraph::new(line.clone())
        .wrap(Wrap { trim: false })
        .line_count(width.max(1))
        .max(1)
}

/// The conversation's measured lines, and what they were built from.
pub struct Cache {
    version: u64,
    accent: Color,
    width: u16,
    measured: Measured,
}

/// The lines in view from `parts` read in order: those overlapping rows
/// `top..top + height`, and how many rows of the first are above the view.
fn window(parts: &[&Measured], top: usize, height: usize) -> (Vec<Line<'static>>, usize) {
    let mut lines = Vec::new();
    let mut offset = 0;
    let mut row = 0;
    for part in parts {
        for (line, rows) in part.lines.iter().zip(&part.heights) {
            let end = row + rows;
            if end > top && row < top + height {
                if lines.is_empty() {
                    offset = top - row;
                }
                lines.push(line.clone());
            }
            row = end;
            if row >= top + height {
                return (lines, offset);
            }
        }
    }
    (lines, offset)
}

/// What the transcript shows in a body `width` columns wide and `height`
/// rows tall: the lines to draw, the rows of the first to skip, and how far
/// the view can scroll back.
pub fn visible(app: &App, width: u16, height: u16) -> (Vec<Line<'static>>, usize, usize) {
    let feed = Measured::new(feed(app), width);
    let height = height as usize;
    let place = |conversation: &Measured| {
        let total = conversation.total + feed.total;
        let bottom = total.saturating_sub(height);
        let top = app.scroll_top.map_or(bottom, |top| top.min(bottom));
        let (lines, offset) = window(&[conversation, &feed], top, height);
        (lines, offset, bottom)
    };
    let Some(view) = &app.view else {
        return place(&Measured::new(welcome(app), width));
    };
    let mut cache = app.transcript.borrow_mut();
    let accent = brand::accent();
    let stale = cache.as_ref().is_none_or(|cache| {
        cache.version != app.view_version || cache.accent != accent || cache.width != width
    });
    if stale {
        *cache = Some(Cache {
            version: app.view_version,
            accent,
            width,
            measured: Measured::new(conversation(view), width),
        });
    }
    place(&cache.as_ref().expect("filled above").measured)
}

fn conversation(view: &SessionView) -> Vec<Line<'static>> {
    let accent = Style::default().fg(brand::accent());
    let muted = Style::default().fg(brand::muted());
    let mut lines = Vec::new();
    for message in &view.messages {
        lines.push(Line::raw(""));
        if message.role == "agent" {
            if let Some(attempt) = message.attempt {
                lines.push(Line::styled(format!("  attempt {attempt}"), muted));
            }
            lines.extend(markdown(&message.text));
            continue;
        }
        let marker = if message.sent { "› " } else { "… " };
        for (index, text) in message.text.lines().enumerate() {
            let lead = if index == 0 { marker } else { "  " };
            lines.push(Line::from(vec![
                Span::styled(lead, accent.add_modifier(Modifier::BOLD)),
                Span::styled(
                    text.to_string(),
                    Style::default().add_modifier(Modifier::BOLD),
                ),
            ]));
        }
    }
    if view.messages.iter().all(|message| message.role != "agent") && !view.result.trim().is_empty()
    {
        // A host that predates agent messages still sends the latest output.
        lines.push(Line::raw(""));
        lines.extend(markdown(&view.result));
    }
    let warning = Style::default().fg(brand::warning());
    for question in &view.questions {
        lines.push(Line::raw(""));
        lines.push(Line::from(vec![
            Span::styled("? ", warning.add_modifier(Modifier::BOLD)),
            Span::styled(
                question.question.clone(),
                Style::default().add_modifier(Modifier::BOLD),
            ),
        ]));
        if !question.options.is_empty() {
            lines.push(Line::styled(
                format!("  {}", question.options.join(" · ")),
                muted,
            ));
        }
        lines.push(Line::styled(
            if question.options.is_empty() {
                "  Type your answer below and press Enter."
            } else {
                "  Choose an answer, or type your own below."
            },
            muted,
        ));
    }
    if let Some(error) = protocol::present(view.error.as_deref()) {
        let danger = Style::default().fg(brand::danger());
        lines.push(Line::raw(""));
        lines.push(Line::from(vec![
            Span::styled("✕ ", danger.add_modifier(Modifier::BOLD)),
            Span::styled(error.to_string(), danger),
        ]));
        lines.push(Line::styled(
            "  /retry to run it again, or reply with what to change",
            muted,
        ));
    }
    lines
}

fn feed(app: &App) -> Vec<Line<'static>> {
    let mut lines = Vec::new();
    let mut previous_was_note = false;
    for entry in &app.feed {
        match entry {
            Entry::Note(text, tone) => {
                if !previous_was_note {
                    lines.push(Line::raw(""));
                }
                lines.push(Line::styled(
                    format!("  {text}"),
                    Style::default().fg(tone.color()),
                ));
                previous_was_note = true;
            }
            Entry::Shell(index) => {
                lines.push(Line::raw(""));
                lines.extend(shell_block(&app.shells[*index], app.tick));
                previous_was_note = false;
            }
        }
    }
    lines
}

fn shell_block(run: &shell::Run, tick: usize) -> Vec<Line<'static>> {
    let muted = Style::default().fg(brand::muted());
    let (tone, glyph) = match &run.finished {
        None => (brand::accent(), brand::spinner(tick).to_string()),
        Some((Ok(0), _)) => (brand::success(), "$".to_string()),
        Some(_) => (brand::danger(), "$".to_string()),
    };
    let mut lines = vec![Line::from(vec![
        Span::styled(
            format!("{glyph} "),
            Style::default().fg(tone).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            run.command.clone(),
            Style::default().add_modifier(Modifier::BOLD),
        ),
        Span::styled(format!("  {}", short_path(&run.directory)), muted),
    ])];
    let hidden = run.dropped + run.output.len().saturating_sub(SHELL_TAIL);
    if hidden > 0 {
        lines.push(Line::styled(format!("  │ … {hidden} earlier lines"), muted));
    }
    for (text, error) in run
        .output
        .iter()
        .skip(run.output.len().saturating_sub(SHELL_TAIL))
    {
        lines.push(Line::from(vec![
            Span::styled("  │ ", muted),
            if *error {
                Span::styled(text.clone(), Style::default().fg(brand::warning()))
            } else {
                Span::raw(text.clone())
            },
        ]));
    }
    let footer = match &run.finished {
        None => format!(
            "  └ running {} · Ctrl+C or /kill to stop",
            duration(run.started.elapsed())
        ),
        Some((Ok(code), took)) => format!("  └ exit {code} · {}", duration(*took)),
        Some((Err(error), _)) => format!("  └ {error}"),
    };
    lines.push(Line::styled(
        footer,
        if run.finished.is_none() {
            muted
        } else {
            Style::default().fg(tone)
        },
    ));
    lines
}

/// `~` for the home directory, so paths fit beside the command.
fn short_path(path: &str) -> String {
    std::env::var("HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok())
        .filter(|home| !home.is_empty())
        .and_then(|home| path.strip_prefix(&home).map(|rest| format!("~{rest}")))
        .unwrap_or_else(|| path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(line: &Line) -> String {
        line.spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect()
    }

    #[test]
    fn heights_follow_word_wrapping_not_character_counts() {
        // Eleven characters fit two rows of six by count, but word wrapping
        // needs three: "aa" / "bbbbb" / "cc".
        let measured = Measured::new(vec![Line::raw("aa bbbbb cc"), Line::raw("")], 6);
        assert_eq!(measured.heights, [3, 1]);
        assert_eq!(measured.total, 4);
    }

    #[test]
    fn the_window_starts_mid_line_when_the_top_falls_inside_one() {
        let first = Measured::new(
            vec![
                Line::raw("zero"),
                Line::raw("one two three"),
                Line::raw("four"),
            ],
            5,
        );
        let second = Measured::new(vec![Line::raw("five"), Line::raw("six")], 5);
        // Rows: zero | one | two | three | four | five | six
        let (lines, offset) = window(&[&first, &second], 2, 3);
        let shown: Vec<String> = lines.iter().map(text).collect();
        assert_eq!(shown, ["one two three", "four"]);
        assert_eq!(offset, 1, "\"one\" is above the view");
        let (lines, offset) = window(&[&first, &second], 5, 2);
        assert_eq!(lines.iter().map(text).collect::<Vec<_>>(), ["five", "six"]);
        assert_eq!(offset, 0);
    }

    #[test]
    fn retried_attempts_are_labelled() {
        let message = |role: &str, text: &str, attempt: Option<u32>| protocol::Message {
            role: role.into(),
            text: text.into(),
            sent: true,
            attempt,
        };
        let view = SessionView {
            id: "s".into(),
            title: "t".into(),
            paused: false,
            error: None,
            messages: vec![
                message("you", "fix it", None),
                message("agent", "first try", Some(1)),
                message("agent", "second try", Some(2)),
            ],
            run_id: None,
            status: None,
            agent: None,
            account: None,
            model: None,
            routing: None,
            step: None,
            step_detail: None,
            attempt: None,
            workspace: None,
            branch: None,
            result: String::new(),
            questions: Vec::new(),
        };
        let shown: Vec<String> = conversation(&view).iter().map(text).collect();
        let first = shown.iter().position(|line| line == "  attempt 1").unwrap();
        let second = shown.iter().position(|line| line == "  attempt 2").unwrap();
        assert!(first < second);
        assert_eq!(shown[second + 1], "second try");
    }
}
