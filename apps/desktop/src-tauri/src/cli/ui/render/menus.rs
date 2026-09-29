//! Popups drawn over the conversation: the command and mention menus above
//! the input, and pickers. They share one look: rounded borders, a tinted
//! full-width row for the highlight, ellipses instead of hard cuts, and the
//! position in the bottom border when the list scrolls.

use crate::brand;
use crate::ui::pickers::{Picker, PickerKind};
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Paragraph};
use ratatui::Frame;

/// The first row to show so `selected` stays in a window of `rows`.
fn window_start(selected: usize, rows: usize) -> usize {
    selected.saturating_sub(rows.saturating_sub(1))
}

/// A popup frame: a rounded border with a hint on top and, when the list is
/// longer than it shows, where the highlight is (`3/24`) on the bottom edge.
fn frame_block(
    title: Span<'static>,
    border: Style,
    position: Option<(usize, usize)>,
) -> Block<'static> {
    let mut block = Block::default()
        .borders(Borders::ALL)
        .border_type(brand::border())
        .border_style(border)
        .title(title);
    if let Some((index, total)) = position {
        block = block.title_bottom(
            Line::styled(
                format!(" {}/{total} ", index + 1),
                Style::default().fg(brand::muted()),
            )
            .right_aligned(),
        );
    }
    block
}

/// One list row padded to `width` so the highlight spans the whole row.
fn row(spans: Vec<Span<'static>>, width: usize, chosen: bool) -> Line<'static> {
    let used: usize = spans.iter().map(|span| span.content.chars().count()).sum();
    let mut spans = spans;
    spans.push(Span::raw(" ".repeat(width.saturating_sub(used))));
    let line = Line::from(spans);
    if chosen {
        line.patch_style(brand::selection())
    } else {
        line
    }
}

/// Files for an `@` mention, in the same place as the command menu.
pub fn mention_menu(frame: &mut Frame, paths: &[String], selected: usize, input: Rect) {
    let accent = Style::default().fg(brand::accent());
    let muted = Style::default().fg(brand::muted());
    let rows = paths.len().min(8);
    let selected = selected.min(paths.len() - 1);
    let first = window_start(selected, rows);
    let area = Rect {
        x: input.x,
        y: input.y.saturating_sub(rows as u16 + 2),
        width: input.width.min(80),
        height: rows as u16 + 2,
    };
    let inner = area.width.saturating_sub(2) as usize;
    let lines: Vec<Line> = paths
        .iter()
        .enumerate()
        .skip(first)
        .take(rows)
        .map(|(index, path)| {
            let (directory, name) = path
                .rsplit_once('/')
                .map_or(("", path.as_str()), |(directory, name)| (directory, name));
            let chosen = index == selected;
            let name = format!(" {name}");
            let room = inner.saturating_sub(name.chars().count() + 2);
            let directory = if directory.is_empty() || room < 4 {
                String::new()
            } else {
                format!("  {}", brand::ellipsize(&format!("{directory}/"), room))
            };
            let name_style = if chosen {
                accent.add_modifier(Modifier::BOLD)
            } else {
                accent
            };
            row(
                vec![
                    Span::styled(name, name_style),
                    Span::styled(directory, muted),
                ],
                inner,
                chosen,
            )
        })
        .collect();
    let position = (paths.len() > rows).then_some((selected, paths.len()));
    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(lines).block(frame_block(
            Span::styled(" ↑↓ choose · Tab or Enter insert · Esc close ", muted),
            muted,
            position,
        )),
        area,
    );
}

/// The command menu, floating just above the input like an editor's completions.
pub fn slash_menu(frame: &mut Frame, matches: &[(&str, &str)], selected: usize, input: Rect) {
    let accent = Style::default().fg(brand::accent());
    let muted = Style::default().fg(brand::muted());
    let rows = matches.len().min(8);
    let selected = selected.min(matches.len() - 1);
    let first = window_start(selected, rows);
    let name_width = matches
        .iter()
        .map(|(name, _)| name.chars().count())
        .max()
        .unwrap_or(0)
        + 1;
    let area = Rect {
        x: input.x,
        y: input.y.saturating_sub(rows as u16 + 2),
        width: input.width.min(76),
        height: rows as u16 + 2,
    };
    let inner = area.width.saturating_sub(2) as usize;
    let lines: Vec<Line> = matches
        .iter()
        .enumerate()
        .skip(first)
        .take(rows)
        .map(|(index, (name, about))| {
            let chosen = index == selected;
            let name = format!(" /{name:<name_width$}");
            let about = brand::ellipsize(about, inner.saturating_sub(name.chars().count() + 2));
            row(
                vec![
                    Span::styled(
                        name,
                        if chosen {
                            accent.add_modifier(Modifier::BOLD)
                        } else {
                            accent
                        },
                    ),
                    Span::styled(
                        format!(" {about}"),
                        if chosen { Style::default() } else { muted },
                    ),
                ],
                inner,
                chosen,
            )
        })
        .collect();
    let position = (matches.len() > rows).then_some((selected, matches.len()));
    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(lines).block(frame_block(
            Span::styled(" ↑↓ choose · Tab complete · Enter run ", muted),
            muted,
            position,
        )),
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
            80
        });
    let visible = (area.height.saturating_sub(10) as usize).clamp(3, 14);
    let rows = shown.len().clamp(1, visible) as u16;
    let popup = Rect {
        x: area.x + (area.width.saturating_sub(width)) / 2,
        // Borders, the filter line and a spacer around the rows.
        y: area.y + (area.height.saturating_sub(rows + 4)) / 3,
        width,
        height: (rows + 4).min(area.height),
    };
    let inner = width.saturating_sub(2) as usize;
    let first = window_start(picker.selected, visible);
    // Rows without details use the whole width; otherwise labels take up to
    // half and details the rest, each shortened with an ellipsis.
    let has_details = picker.items.iter().any(|item| !item.detail.is_empty());
    let label_width = if has_details {
        (inner / 2).saturating_sub(3)
    } else {
        inner.saturating_sub(4)
    };
    let detail_width = inner.saturating_sub(label_width + 4);
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
    lines.push(Line::raw(""));
    lines.extend(
        shown
            .iter()
            .enumerate()
            .skip(first)
            .take(visible)
            .map(|(position, index)| {
                let item = &picker.items[*index];
                let chosen = position == picker.selected;
                let label = brand::ellipsize(&item.label, label_width);
                let label = format!("{label:<label_width$}");
                let lead = if chosen {
                    format!(" {} ", brand::mark_glyph(brand::Mark::Cursor))
                } else {
                    "   ".into()
                };
                row(
                    vec![
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
                            format!(" {}", brand::ellipsize(&item.detail, detail_width)),
                            if chosen { accent } else { muted },
                        ),
                    ],
                    inner,
                    chosen,
                )
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
    let position = (shown.len() > visible).then_some((picker.selected, shown.len()));
    let hint = if picker.kind == PickerKind::Settings {
        " ↑↓ choose · Enter change · Esc close "
    } else {
        " ↑↓ choose · Enter select · Esc close "
    };
    let mut block = frame_block(
        Span::styled(
            format!(" {} ", picker.title),
            accent.add_modifier(Modifier::BOLD),
        ),
        accent,
        position,
    );
    block = block.title_bottom(Line::styled(hint, muted));
    frame.render_widget(Clear, popup);
    frame.render_widget(Paragraph::new(lines).block(block), popup);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn highlighted_rows_fill_their_width_and_windows_follow_the_cursor() {
        let line = row(vec![Span::raw("abc")], 10, true);
        let width: usize = line
            .spans
            .iter()
            .map(|span| span.content.chars().count())
            .sum();
        assert_eq!(width, 10);
        assert_eq!(window_start(2, 8), 0);
        assert_eq!(window_start(12, 8), 5);
    }
}
