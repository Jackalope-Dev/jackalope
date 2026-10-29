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
/// Steps of running work shown under the conversation, and the characters
/// kept from each.
const ACTIVITY_SHOWN: usize = 6;
const ACTIVITY_WIDTH: usize = 160;

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
        return place(&Measured::new(welcome(app, width, height as u16), width));
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
            measured: Measured::new(conversation(view, width), width),
        });
    }
    place(&cache.as_ref().expect("filled above").measured)
}

fn conversation(view: &SessionView, width: u16) -> Vec<Line<'static>> {
    let accent = Style::default().fg(brand::accent());
    let muted = Style::default().fg(brand::muted());
    let mut lines = Vec::new();
    for message in &view.messages {
        lines.push(Line::raw(""));
        if message.role == "agent" {
            // Who is speaking, so replies stand apart from your messages.
            let mut label = vec![
                Span::styled(if brand::unicode() { "● " } else { "* " }, accent),
                Span::styled(view.agent.clone().unwrap_or_else(|| "agent".into()), muted),
            ];
            if let Some(attempt) = message.attempt {
                label.push(Span::styled(format!(" · attempt {attempt}"), muted));
            }
            lines.push(Line::from(label));
            lines.extend(markdown(&message.text));
            continue;
        }
        // Your messages sit in a tinted block with the accent down its left
        // edge; queued ones stay quiet until they are sent.
        let (color, text_style) = if message.sent {
            (brand::accent(), Style::default().fg(brand::text()))
        } else {
            (brand::muted(), muted)
        };
        let mut body: Vec<Vec<Span<'static>>> = message
            .text
            .lines()
            .map(|text| vec![Span::styled(text.to_string(), text_style)])
            .collect();
        if !message.sent {
            body.push(vec![Span::styled(
                "queued",
                muted.add_modifier(Modifier::ITALIC),
            )]);
        }
        lines.extend(callout(body, color, width));
    }
    if view.messages.iter().all(|message| message.role != "agent")
        && view.partial.is_empty()
        && !view.result.trim().is_empty()
    {
        // A host that predates agent messages still sends the latest output.
        lines.push(Line::raw(""));
        lines.extend(markdown(&view.result));
    }
    if protocol::working(view.status.as_deref()) {
        if !view.partial.trim().is_empty() {
            // The reply as it is written, ending in a cursor.
            lines.push(Line::raw(""));
            lines.push(Line::from(vec![
                Span::styled(if brand::unicode() { "● " } else { "* " }, accent),
                Span::styled(view.agent.clone().unwrap_or_else(|| "agent".into()), muted),
            ]));
            let mut reply = markdown(&view.partial);
            let cursor = Span::styled(if brand::unicode() { "▍" } else { "_" }, accent);
            match reply.last_mut() {
                Some(line) => line.spans.push(cursor),
                None => reply.push(Line::from(cursor)),
            }
            lines.extend(reply);
        }
        lines.extend(activity(&view.activity));
    }
    let warning = Style::default().fg(brand::warning());
    for question in &view.questions {
        lines.push(Line::raw(""));
        lines.push(Line::from(vec![
            Span::styled(if brand::unicode() { "◆ " } else { "? " }, warning),
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
    lines
}

/// Rows of spans as a block: a bar of `color` down the left edge and its
/// tint behind every row, wrapped and padded to `width` so the tint is even.
pub(super) fn callout(
    rows: Vec<Vec<Span<'static>>>,
    color: Color,
    width: u16,
) -> Vec<Line<'static>> {
    let bar = Span::styled(
        if brand::unicode() { "▎ " } else { "| " },
        Style::default().fg(color),
    );
    let fill = brand::callout_style(color);
    let room = usize::from(width).saturating_sub(3).max(8);
    let mut lines = Vec::new();
    for spans in rows {
        for row in wrap(spans, room) {
            let used: usize = row.iter().map(Span::width).sum();
            let mut line = vec![bar.clone()];
            line.extend(row);
            line.push(Span::raw(" ".repeat(room.saturating_sub(used) + 1)));
            lines.push(Line::from(line).patch_style(fill));
        }
    }
    lines
}

/// Spans broken into rows of at most `room` columns at spaces, or mid-word
/// when a word alone is too long.
fn wrap(spans: Vec<Span<'static>>, room: usize) -> Vec<Vec<Span<'static>>> {
    let mut rows = vec![Vec::new()];
    let mut used = 0;
    for span in spans {
        let style = span.style;
        for word in span.content.split_inclusive(' ') {
            let mut word = word.to_string();
            loop {
                let columns = unicode_width::UnicodeWidthStr::width(word.trim_end());
                if used > 0 && used + columns > room {
                    rows.push(Vec::new());
                    used = 0;
                }
                if columns <= room {
                    used += unicode_width::UnicodeWidthStr::width(word.as_str());
                    rows.last_mut()
                        .expect("one row")
                        .push(Span::styled(word, style));
                    break;
                }
                let split = word
                    .char_indices()
                    .nth(room)
                    .map_or(word.len(), |(index, _)| index);
                let rest = word.split_off(split);
                rows.last_mut()
                    .expect("one row")
                    .push(Span::styled(word, style));
                rows.push(Vec::new());
                used = 0;
                word = rest;
            }
        }
    }
    rows
}

/// The newest steps of running work, one line each, so a long run shows what
/// it is doing rather than only a spinner.
fn activity(entries: &[String]) -> Vec<Line<'static>> {
    let muted = Style::default().fg(brand::muted());
    let summaries: Vec<String> = entries
        .iter()
        .filter_map(|entry| {
            let first = entry.lines().map(str::trim).find(|line| !line.is_empty())?;
            let mut summary: String = first.chars().take(ACTIVITY_WIDTH).collect();
            if first.chars().count() > ACTIVITY_WIDTH || entry.trim().lines().nth(1).is_some() {
                summary.push('…');
            }
            Some(summary)
        })
        .collect();
    let shown = &summaries[summaries.len().saturating_sub(ACTIVITY_SHOWN)..];
    let Some((newest, earlier)) = shown.split_last() else {
        return Vec::new();
    };
    let mut lines = vec![Line::raw("")];
    for summary in earlier {
        lines.push(Line::styled(format!("  │ {summary}"), muted));
    }
    lines.push(Line::from(vec![
        Span::styled("  └ ", muted),
        Span::raw(newest.clone()),
    ]));
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
            id: None,
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
            activity: Vec::new(),
            questions: Vec::new(),
            partial: String::new(),
            review_screenshots: None,
            merged: false,
        };
        let shown: Vec<String> = conversation(&view, 80).iter().map(text).collect();
        let first = shown
            .iter()
            .position(|line| line.ends_with("agent · attempt 1"))
            .unwrap();
        let second = shown
            .iter()
            .position(|line| line.ends_with("agent · attempt 2"))
            .unwrap();
        assert!(first < second);
        assert_eq!(shown[second + 1], "second try");
    }

    #[test]
    fn callouts_wrap_at_words_and_fill_every_row_to_one_width() {
        let lines = callout(
            vec![vec![Span::raw(
                "a fairly long sentence that has to wrap across several rows here",
            )]],
            brand::accent(),
            24,
        );
        assert!(lines.len() > 1);
        let widths: Vec<usize> = lines.iter().map(Line::width).collect();
        assert!(widths.iter().all(|width| *width == widths[0]), "{widths:?}");
        // A word longer than a row is split rather than overflowing.
        let long = wrap(vec![Span::raw("x".repeat(50))], 20);
        assert_eq!(long.len(), 3);
        assert!(long
            .iter()
            .all(|row| row.iter().map(Span::width).sum::<usize>() <= 20));
    }
}
