//! Popups drawn over the conversation: the command and mention menus above
//! the input, and pickers.

use crate::brand;
use crate::ui::pickers::{Picker, PickerKind};
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Paragraph};
use ratatui::Frame;

/// Files for an `@` mention, in the same place as the command menu.
pub fn mention_menu(frame: &mut Frame, paths: &[String], selected: usize, input: Rect) {
    let accent = Style::default().fg(brand::accent());
    let muted = Style::default().fg(brand::muted());
    let rows = paths.len().min(8) as u16;
    let selected = selected.min(paths.len() - 1);
    let area = Rect {
        x: input.x,
        y: input.y.saturating_sub(rows + 2),
        width: input.width.min(80),
        height: rows + 2,
    };
    let lines: Vec<Line> = paths
        .iter()
        .enumerate()
        .map(|(index, path)| {
            let (directory, name) = path
                .rsplit_once('/')
                .map_or(("", path.as_str()), |(directory, name)| (directory, name));
            let chosen = index == selected;
            Line::from(vec![
                Span::styled(
                    format!(" {name}"),
                    if chosen {
                        accent.add_modifier(Modifier::BOLD | Modifier::REVERSED)
                    } else {
                        accent
                    },
                ),
                Span::styled(
                    if directory.is_empty() {
                        String::new()
                    } else {
                        format!("  {directory}/")
                    },
                    muted,
                ),
            ])
        })
        .collect();
    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(lines).block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(muted)
                .title(Span::styled(
                    " ↑↓ choose · Tab or Enter insert · Esc close ",
                    muted,
                )),
        ),
        area,
    );
}

/// The command menu, floating just above the input like an editor's completions.
pub fn slash_menu(frame: &mut Frame, matches: &[(&str, &str)], selected: usize, input: Rect) {
    let accent = Style::default().fg(brand::accent());
    let muted = Style::default().fg(brand::muted());
    let rows = matches.len().min(8) as u16;
    let selected = selected.min(matches.len() - 1);
    // Keep the highlighted row visible when the list is longer than the menu.
    let first = selected.saturating_sub(rows as usize - 1);
    let area = Rect {
        x: input.x,
        y: input.y.saturating_sub(rows + 2),
        width: input.width.min(64),
        height: rows + 2,
    };
    let lines: Vec<Line> = matches
        .iter()
        .enumerate()
        .skip(first)
        .take(rows as usize)
        .map(|(index, (name, about))| {
            let chosen = index == selected;
            let name_style = if chosen {
                accent.add_modifier(Modifier::BOLD | Modifier::REVERSED)
            } else {
                accent
            };
            Line::from(vec![
                Span::styled(format!(" /{name:<10}"), name_style),
                Span::styled(
                    format!(" {about}"),
                    if chosen { Style::default() } else { muted },
                ),
            ])
        })
        .collect();
    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(lines).block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(muted)
                .title(Span::styled(
                    " ↑↓ choose · Tab complete · Enter run ",
                    muted,
                )),
        ),
        area,
    );
}

pub fn picker(frame: &mut Frame, picker: &Picker, area: Rect) {
    let accent = Style::default().fg(brand::accent());
    let muted = Style::default().fg(brand::muted());
    let shown = picker.shown();
    let width = area
        .width
        .saturating_sub(4)
        .min(if picker.kind == PickerKind::History {
            100
        } else {
            76
        });
    let visible = (area.height.saturating_sub(10) as usize).clamp(3, 14);
    let rows = shown.len().clamp(1, visible) as u16;
    let popup = Rect {
        x: area.x + (area.width.saturating_sub(width)) / 2,
        y: area.y + (area.height.saturating_sub(rows + 6)) / 3,
        width,
        height: (rows + 6).min(area.height),
    };
    let first = picker.selected.saturating_sub(visible - 1);
    // Rows without details use the whole width.
    let label_width = if picker.items.iter().all(|item| item.detail.is_empty()) {
        (width as usize).saturating_sub(5)
    } else {
        (width as usize / 2).saturating_sub(2)
    };
    let mut lines: Vec<Line> = vec![Line::from(if picker.filter.is_empty() {
        vec![Span::styled("  type to filter", muted)]
    } else {
        vec![
            Span::styled("  ", muted),
            Span::styled(
                picker.filter.clone(),
                Style::default().add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!("  {} of {}", shown.len(), picker.items.len()),
                muted,
            ),
        ]
    })];
    lines.extend(
        shown
            .iter()
            .enumerate()
            .skip(first)
            .take(visible)
            .map(|(position, index)| {
                let item = &picker.items[*index];
                let chosen = position == picker.selected;
                let mut label: String = item.label.chars().take(label_width).collect();
                label = format!("{label:<label_width$}");
                let lead = if chosen {
                    format!("{} ", brand::mark_glyph(brand::Mark::Cursor))
                } else {
                    "  ".into()
                };
                Line::from(vec![
                    Span::styled(lead, accent),
                    Span::styled(
                        label,
                        if chosen {
                            Style::default().add_modifier(Modifier::BOLD)
                        } else {
                            Style::default()
                        },
                    ),
                    Span::styled(
                        format!(" {}", item.detail),
                        if chosen { accent } else { muted },
                    ),
                ])
            }),
    );
    if shown.is_empty() {
        lines.push(Line::styled(
            if picker.items.is_empty() {
                "  Nothing here yet."
            } else {
                "  No matches. Backspace or Esc to widen."
            },
            muted,
        ));
    }
    lines.push(Line::raw(""));
    lines.push(Line::styled(
        if picker.kind == PickerKind::Settings {
            "  ↑↓ choose · Enter change · Esc close"
        } else {
            "  ↑↓ choose · Enter select · Esc close"
        },
        muted,
    ));
    frame.render_widget(Clear, popup);
    frame.render_widget(
        Paragraph::new(lines).block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(accent)
                .title(Span::styled(
                    format!(" {} ", picker.title),
                    accent.add_modifier(Modifier::BOLD),
                )),
        ),
        popup,
    );
}
