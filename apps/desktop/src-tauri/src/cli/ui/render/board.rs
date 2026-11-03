//! The board: every open conversation as one row, in place of the transcript,
//! so several agents can be watched and the one that needs you opened.
//!
//! Rows come from the host's session list; the order (needs you, then
//! working, then the rest) is set where the picker is built, and the picker
//! owns selection, filtering and Enter.

use super::super::conversation::needs_you;
use super::super::pickers::{Action, Picker};
use super::super::{App, Click};
use super::hit;
use crate::brand::{self, Surface};
use crate::protocol::{self, SessionSummary};
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Clear, Paragraph};
use ratatui::Frame;

/// Columns for the state, agent and (on wide boards) the project.
const STATE_WIDTH: usize = 13;
const AGENT_WIDTH: usize = 14;

/// A conversation's state as a glyph, a label and its colour.
fn state(app: &App, session: &SessionSummary) -> (&'static str, &'static str, Color) {
    let unicode = brand::unicode();
    if needs_you(session) {
        (
            if unicode { "◆" } else { "!" },
            "NEEDS YOU",
            brand::warning(),
        )
    } else if protocol::working(session.status.as_deref()) {
        (brand::spinner(app.tick), "WORKING", brand::accent())
    } else if session.paused {
        (if unicode { "‖" } else { "=" }, "PAUSED", brand::muted())
    } else {
        match session.status.as_deref() {
            Some("review") => (if unicode { "✓" } else { "+" }, "READY", brand::success()),
            Some("reviewed") => (if unicode { "✓" } else { "+" }, "REVIEWED", brand::muted()),
            Some("failed" | "error") => {
                (if unicode { "✗" } else { "x" }, "FAILED", brand::danger())
            }
            Some(status) if protocol::STOPPED.contains(&status) => {
                (if unicode { "■" } else { "#" }, "STOPPED", brand::muted())
            }
            _ => (if unicode { "○" } else { "o" }, "IDLE", brand::muted()),
        }
    }
}

/// What a row says the conversation is doing or waiting on.
fn doing(app: &App, session: &SessionSummary) -> String {
    let mut text = if session.asking {
        "asking a question".to_string()
    } else if let Some(error) = protocol::present(session.error.as_deref()) {
        error.lines().next().unwrap_or_default().to_string()
    } else if protocol::working(session.status.as_deref()) {
        session.step.clone().unwrap_or_else(|| "working".into())
    } else {
        match session.status.as_deref() {
            Some("review") => "ready to review".into(),
            _ => String::new(),
        }
    };
    if session.pending > 0 {
        let queued = format!("{} queued", session.pending);
        text = if text.is_empty() {
            queued
        } else {
            format!("{text} · {queued}")
        };
    }
    if session.project_id != app.project.id {
        let project = app.project_name(&session.project_id);
        text = if text.is_empty() {
            project
        } else {
            format!("{project} · {text}")
        };
    }
    text
}

pub fn draw(frame: &mut Frame, app: &App, picker: &Picker, area: Rect) {
    frame.render_widget(Clear, area);
    frame.render_widget(
        Block::default().style(brand::painted_style(Surface::Ground)),
        area,
    );
    let width = usize::from(area.width);
    let muted = Style::default().fg(brand::muted());
    let shown = picker.shown();
    let rows: Vec<&SessionSummary> = shown
        .iter()
        .filter_map(|index| match &picker.items[*index].action {
            Action::Session(id) => app.sessions.iter().find(|session| &session.id == id),
            _ => None,
        })
        .collect();

    let waiting = app
        .sessions
        .iter()
        .filter(|session| needs_you(session))
        .count();
    let working = app
        .sessions
        .iter()
        .filter(|session| !needs_you(session) && protocol::working(session.status.as_deref()))
        .count();
    let mut header = vec![
        Span::styled(
            "BOARD",
            Style::default()
                .fg(brand::accent())
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(format!("   {} open", app.sessions.len()), muted),
    ];
    if waiting > 0 {
        header.push(Span::styled(" · ", muted));
        header.push(Span::styled(
            format!("{waiting} need you"),
            Style::default().fg(brand::warning()),
        ));
    }
    if working > 0 {
        header.push(Span::styled(" · ", muted));
        header.push(Span::styled(
            format!("{working} working"),
            Style::default().fg(brand::accent()),
        ));
    }
    if !picker.filter.is_empty() {
        header.push(Span::styled("   filter ", muted));
        header.push(Span::styled(
            picker.filter.clone(),
            Style::default().add_modifier(Modifier::BOLD),
        ));
    }
    let mut lines = vec![
        Line::raw(""),
        Line::from(header),
        brand::divider(area.width),
    ];

    let title_width = width.saturating_sub(STATE_WIDTH + AGENT_WIDTH + 6) * 3 / 5;
    let doing_width = width.saturating_sub(STATE_WIDTH + AGENT_WIDTH + title_width + 6);
    let room = usize::from(area.height).saturating_sub(lines.len() + 2);
    let first = picker.selected.saturating_sub(room.saturating_sub(1));
    for (position, session) in rows.iter().enumerate().skip(first).take(room) {
        let (glyph, label, color) = state(app, session);
        let chosen = position == picker.selected;
        let showing = app.session.as_deref() == Some(session.id.as_str());
        let title = brand::ellipsize(&session.title, title_width);
        let agent = brand::ellipsize(session.agent.as_deref().unwrap_or(""), AGENT_WIDTH);
        let doing = brand::ellipsize(&doing(app, session), doing_width);
        let mut spans = vec![
            Span::styled(
                if chosen {
                    format!("{} ", brand::mark_glyph(brand::Mark::Cursor))
                } else {
                    "  ".into()
                },
                Style::default().fg(brand::accent()),
            ),
            Span::styled(format!("{glyph} "), Style::default().fg(color)),
            Span::styled(
                format!("{label:<width$}", width = STATE_WIDTH - 2),
                Style::default().fg(color).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!("{title:<title_width$}  "),
                if chosen || showing {
                    Style::default()
                        .fg(brand::text())
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(brand::text())
                },
            ),
            Span::styled(format!("{agent:<AGENT_WIDTH$}  "), muted),
            Span::styled(doing, muted),
        ];
        let used: usize = spans.iter().map(Span::width).sum();
        spans.push(Span::raw(" ".repeat(width.saturating_sub(used))));
        let line = Line::from(spans);
        let y = area.y + lines.len() as u16;
        hit(
            app,
            Rect::new(area.x, y, area.width, 1),
            Click::Row(position),
        );
        lines.push(if chosen {
            line.patch_style(brand::selection())
        } else {
            line
        });
    }
    if rows.is_empty() {
        lines.push(Line::raw(""));
        lines.push(Line::styled(
            if picker.filter.is_empty() {
                "  No open conversations · /new starts one"
            } else {
                "  Nothing matches the filter"
            },
            muted,
        ));
    }
    frame.render_widget(Paragraph::new(lines), area);

    let hint = Line::styled(" ↑↓ choose · Enter open · type to filter · Esc back", muted);
    let bottom = Rect {
        y: area.y + area.height.saturating_sub(1),
        height: 1,
        ..area
    };
    frame.render_widget(Paragraph::new(hint), bottom);
}
