//! Panels the interface opens as work needs them: the changed files beside
//! the conversation, and a pending question pinned above the input.

use super::menus::{frame_block, row, window_start};
use crate::brand;
use crate::git::FileChange;
use crate::ui::App;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

/// Below this width the panel goes under the conversation instead of beside it.
const SIDE_BY_SIDE: u16 = 100;

/// Splits the body between the conversation and the changes panel, when the
/// panel is showing and there is room for both.
pub fn split(app: &App, body: Rect) -> (Rect, Option<Rect>) {
    if !app.panel_shown() {
        return (body, None);
    }
    if body.width >= SIDE_BY_SIDE {
        let side = (body.width * 2 / 5).clamp(44, 90);
        let [conversation, panel] =
            Layout::horizontal([Constraint::Min(40), Constraint::Length(side)]).areas(body);
        (conversation, Some(panel))
    } else if body.height >= 16 {
        let [conversation, panel] =
            Layout::vertical([Constraint::Min(6), Constraint::Percentage(55)]).areas(body);
        (conversation, Some(panel))
    } else {
        (body, None)
    }
}

/// The status glyph for a change, coloured by what happened to the file.
fn status_span(change: &FileChange) -> Span<'static> {
    let (glyph, color) = match change.status {
        'A' | '?' => ("+", brand::success()),
        'D' => ("−", brand::danger()),
        'R' => ("→", brand::warning()),
        _ => ("•", brand::accent()),
    };
    Span::styled(
        format!(" {glyph} "),
        Style::default().fg(color).add_modifier(Modifier::BOLD),
    )
}

fn counts(change: &FileChange) -> Vec<Span<'static>> {
    match (change.added, change.removed) {
        (Some(added), Some(removed)) => vec![
            Span::styled(format!("+{added}"), Style::default().fg(brand::success())),
            Span::raw(" "),
            Span::styled(format!("−{removed}"), Style::default().fg(brand::danger())),
        ],
        _ => vec![Span::styled("binary", Style::default().fg(brand::muted()))],
    }
}

/// The path shortened from the left to `width`, keeping the file name.
fn fit_path(path: &str, width: usize) -> String {
    let length = path.chars().count();
    if length <= width {
        return path.to_string();
    }
    let keep = width.saturating_sub(1);
    let tail: String = path.chars().skip(length - keep).collect();
    format!("…{tail}")
}

pub fn changes(frame: &mut Frame, app: &App, area: Rect) {
    let muted = Style::default().fg(brand::muted());
    let added: usize = app.changes.iter().filter_map(|change| change.added).sum();
    let removed: usize = app.changes.iter().filter_map(|change| change.removed).sum();
    let files = app.changes.len();
    let title = Span::styled(
        format!(
            " {files} {} changed · +{added} −{removed} ",
            if files == 1 { "file" } else { "files" }
        ),
        Style::default()
            .fg(brand::accent())
            .add_modifier(Modifier::BOLD),
    );
    let selected = app.selected_index();
    let block = frame_block(title, muted, Some((selected, files))).title_bottom(Line::styled(
        " Alt+↑↓ file · Ctrl+O hide · /review in app ",
        muted,
    ));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    if inner.height < 3 || inner.width < 12 {
        return;
    }

    let width = inner.width as usize;
    let list_rows = files.min((inner.height as usize / 3).max(3));
    let first = window_start(selected, list_rows);
    let mut lines: Vec<Line> = app
        .changes
        .iter()
        .enumerate()
        .skip(first)
        .take(list_rows)
        .map(|(index, change)| {
            let count = counts(change);
            let count_width: usize = count.iter().map(|span| span.content.chars().count()).sum();
            let room = width.saturating_sub(count_width + 5);
            let mut spans = vec![status_span(change)];
            let path = format!("{:<room$}", fit_path(&change.path, room));
            spans.push(Span::raw(path));
            spans.push(Span::raw(" "));
            spans.extend(count);
            row(spans, width, index == selected)
        })
        .collect();

    lines.push(Line::styled("─".repeat(width), muted));
    let room = (inner.height as usize).saturating_sub(lines.len());
    let diff = app.selected_diff();
    let hidden = diff.len().saturating_sub(room);
    for text in diff.iter().take(if hidden > 0 {
        room.saturating_sub(1)
    } else {
        room
    }) {
        lines.push(diff_line(text));
    }
    if hidden > 0 {
        lines.push(Line::styled(
            format!(" … {} more lines · /review for the full diff", hidden + 1),
            muted,
        ));
    }
    frame.render_widget(Paragraph::new(lines), inner);
}

fn diff_line(text: &str) -> Line<'static> {
    let style = if text.starts_with("@@") {
        Style::default().fg(brand::accent())
    } else if text.starts_with('+') {
        Style::default().fg(brand::success())
    } else if text.starts_with('-') {
        Style::default().fg(brand::danger())
    } else {
        Style::default().fg(brand::muted())
    };
    Line::styled(text.to_string(), style)
}

/// A pending question kept in view above the input, so it cannot scroll away.
pub fn question_card(app: &App, width: u16) -> Vec<Line<'static>> {
    let Some(question) = app.question() else {
        return Vec::new();
    };
    let warning = Style::default().fg(brand::warning());
    let muted = Style::default().fg(brand::muted());
    let room = (width as usize).saturating_sub(4);
    let text: String = question
        .question
        .lines()
        .next()
        .unwrap_or_default()
        .to_string();
    let shown: String = if text.chars().count() > room {
        let mut cut: String = text.chars().take(room.saturating_sub(1)).collect();
        cut.push('…');
        cut
    } else {
        text
    };
    let hint = if question.options.is_empty() {
        "  Type your answer below and press Enter".to_string()
    } else {
        format!(
            "  {} options · /answer to choose · or type your own",
            question.options.len()
        )
    };
    vec![
        Line::from(vec![
            Span::styled(" ? ", warning.add_modifier(Modifier::BOLD)),
            Span::styled(shown, Style::default().add_modifier(Modifier::BOLD)),
        ]),
        Line::styled(hint, muted),
    ]
}
