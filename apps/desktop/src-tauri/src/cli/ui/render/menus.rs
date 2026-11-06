//! Popups drawn over the conversation: the command and mention menus above
//! the input, and pickers. They share one look: rounded borders, a tinted
//! full-width row for the highlight, ellipses instead of hard cuts, and the
//! position in the bottom border when the list scrolls.

use super::super::{Click, Mention};
use std::cell::RefCell;

/// Where the frame being drawn put each clickable thing.
pub type Hits = RefCell<Vec<(Rect, Click)>>;
use crate::brand;
use crate::ui::pickers::{Picker, PickerKind};
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Padding, Paragraph, Wrap};
use ratatui::Frame;

/// Makes each of a menu's `rows` rows, the first being entry `first`,
/// clickable inside its border.
fn menu_hits(hits: &Hits, area: Rect, first: usize, rows: usize) {
    for row in 0..rows {
        let y = area.y + 1 + row as u16;
        if y + 1 < area.bottom() {
            hits.borrow_mut().push((
                Rect::new(area.x + 1, y, area.width.saturating_sub(2), 1),
                Click::Menu(first + row),
            ));
        }
    }
}

/// Makes the picker rows drawn from row `top` of `area` clickable: `count`
/// rows, the first at position `first` of the shown list.
fn row_hits(hits: &Hits, area: Rect, top: u16, first: usize, count: usize) {
    for row in 0..count {
        let y = top + row as u16;
        if y < area.bottom().saturating_sub(1) {
            hits.borrow_mut().push((
                Rect::new(area.x + 1, y, area.width.saturating_sub(2), 1),
                Click::Row(first + row),
            ));
        }
    }
}

/// The first row to show so `selected` stays in a window of `rows`.
pub(super) fn window_start(selected: usize, rows: usize) -> usize {
    selected.saturating_sub(rows.saturating_sub(1))
}

/// A popup frame: a rounded border with a hint on top and, when the list is
/// longer than it shows, where the highlight is (`3/24`) on the bottom edge.
pub(super) fn frame_block(
    title: Span<'static>,
    border: Style,
    position: Option<(usize, usize)>,
) -> Block<'static> {
    let mut block = Block::default()
        .borders(Borders::ALL)
        .border_type(brand::border())
        .border_style(border)
        .style(brand::painted_style(brand::Surface::Elevated))
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
pub(super) fn row(spans: Vec<Span<'static>>, width: usize, chosen: bool) -> Line<'static> {
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

/// Agents and files for an `@` mention, in the same place as the command
/// menu.
pub fn mention_menu(
    frame: &mut Frame,
    hits: &Hits,
    mentions: &[Mention],
    selected: usize,
    input: Rect,
) {
    let accent = Style::default().fg(brand::accent());
    let muted = Style::default().fg(brand::muted());
    let rows = mentions.len().min(8);
    let selected = selected.min(mentions.len() - 1);
    let first = window_start(selected, rows);
    let area = Rect {
        x: input.x,
        y: input.y.saturating_sub(rows as u16 + 2),
        width: input.width.min(80),
        height: rows as u16 + 2,
    };
    let inner = area.width.saturating_sub(2) as usize;
    let lines: Vec<Line> = mentions
        .iter()
        .enumerate()
        .skip(first)
        .take(rows)
        .map(|(index, mention)| {
            let chosen = index == selected;
            let strong = |style: Style| {
                if chosen {
                    style.add_modifier(Modifier::BOLD)
                } else {
                    style
                }
            };
            match mention {
                Mention::Agent { name, .. } => row(
                    vec![
                        Span::styled(
                            format!(" {} {name}", if brand::unicode() { "●" } else { "*" }),
                            strong(Style::default().fg(brand::info())),
                        ),
                        Span::styled("  agent · starts the message with it", muted),
                    ],
                    inner,
                    chosen,
                ),
                Mention::File(path) => {
                    let (directory, name) = path
                        .rsplit_once('/')
                        .map_or(("", path.as_str()), |(directory, name)| (directory, name));
                    let name = format!(" {name}");
                    let room = inner.saturating_sub(name.chars().count() + 2);
                    let directory = if directory.is_empty() || room < 4 {
                        String::new()
                    } else {
                        format!("  {}", brand::ellipsize(&format!("{directory}/"), room))
                    };
                    row(
                        vec![
                            Span::styled(name, strong(accent)),
                            Span::styled(directory, muted),
                        ],
                        inner,
                        chosen,
                    )
                }
            }
        })
        .collect();
    menu_hits(hits, area, first, rows);
    let position = (mentions.len() > rows).then_some((selected, mentions.len()));
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
pub fn slash_menu(
    frame: &mut Frame,
    hits: &Hits,
    matches: &[(&str, &str)],
    selected: usize,
    input: Rect,
) {
    let accent = Style::default().fg(brand::command());
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
    menu_hits(hits, area, first, rows);
    let position = (matches.len() > rows).then_some((selected, matches.len()));
    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(lines).block(frame_block(
            Span::styled(" ↑↓ choose · Tab complete · Enter run ", muted),
            Style::default().fg(brand::command()),
            position,
        )),
        area,
    );
}

pub fn picker(frame: &mut Frame, hits: &Hits, picker: &Picker, area: Rect) {
    let width = area
        .width
        .saturating_sub(4)
        .min(if picker.kind == PickerKind::History {
            100
        } else {
            80
        });
    // A title's first line goes on the border; later lines (a question's
    // detail, such as the command a permission request would run) sit above
    // the rows so nothing the user is deciding on is cut off.
    let mut title_lines = picker.title.lines();
    let heading = title_lines.next().unwrap_or_default().to_string();
    let context: Vec<Line<'static>> = title_lines
        .filter(|line| !line.trim().is_empty())
        .take(6)
        .map(|line| {
            Line::raw(format!(
                "  {}",
                brand::ellipsize(line, (width as usize).saturating_sub(6))
            ))
        })
        .collect();
    let context_rows = if context.is_empty() {
        0
    } else {
        context.len() as u16 + 1
    };
    let visible = (area.height.saturating_sub(10 + context_rows) as usize).clamp(3, 14);
    let rows = picker.shown().len().clamp(1, visible) as u16 + context_rows;
    let popup = Rect {
        x: area.x + (area.width.saturating_sub(width)) / 2,
        // Borders, the filter line and a spacer around the rows.
        y: area.y + (area.height.saturating_sub(rows + 4)) / 3,
        width,
        height: (rows + 4).min(area.height),
    };
    let title = Span::styled(
        format!(
            " {} ",
            brand::ellipsize(&heading, (width as usize).saturating_sub(6))
        ),
        Style::default()
            .fg(brand::accent())
            .add_modifier(Modifier::BOLD),
    );
    let (lines, rows_from) = picker_lines(picker, context, width, visible);
    let first = window_start(picker.selected, visible);
    let count = picker.shown().len().saturating_sub(first).min(visible);
    row_hits(hits, popup, popup.y + 1 + rows_from as u16, first, count);
    frame.render_widget(Clear, popup);
    frame.render_widget(
        Paragraph::new(lines).block(picker_block(picker, title, visible)),
        popup,
    );
}

/// The question picker docked where the input sits, across its full width,
/// so the conversation above stays in view while you choose. Its whole title
/// wraps inside rather than being cut to fit the border.
pub struct Docked {
    context: Vec<Line<'static>>,
    context_rows: u16,
    visible: usize,
}

impl Docked {
    /// Lays the picker out `width` columns wide in at most `most` rows.
    pub fn new(picker: &Picker, width: u16, most: u16) -> Self {
        // Borders and a column of padding each side, so wrapped lines align.
        let inner = width.saturating_sub(4);
        let mut lines = picker.title.lines().filter(|line| !line.trim().is_empty());
        let mut context = Vec::new();
        if let Some(heading) = lines.next() {
            context.push(Line::styled(
                heading.to_string(),
                Style::default().add_modifier(Modifier::BOLD),
            ));
        }
        context.extend(
            lines
                .take(6)
                .map(|line| Line::styled(line.to_string(), Style::default().fg(brand::muted()))),
        );
        // At most half the room for the question, so its options still show.
        let mut context_rows = 0;
        let mut kept = 0;
        for line in &context {
            let rows = super::transcript::rows(line, inner) as u16;
            if kept > 0 && context_rows + rows > most / 2 {
                break;
            }
            context_rows += rows;
            kept += 1;
        }
        context.truncate(kept);
        if !context.is_empty() {
            context.push(Line::raw(""));
            context_rows += 1;
        }
        let room = most.saturating_sub(context_rows + 4) as usize;
        let visible = picker.shown().len().clamp(1, room.clamp(3, 14));
        Self {
            context,
            context_rows,
            visible,
        }
    }

    /// Rows the dock takes: borders, the question, the filter line, a spacer
    /// and the options.
    pub fn height(&self) -> u16 {
        self.context_rows + self.visible as u16 + 4
    }

    pub fn draw(self, frame: &mut Frame, hits: &Hits, picker: &Picker, area: Rect) {
        let warning = Style::default().fg(brand::warning());
        let title = Span::styled(" ? Question ", warning.add_modifier(Modifier::BOLD));
        let (lines, _) = picker_lines(
            picker,
            self.context,
            area.width.saturating_sub(2),
            self.visible,
        );
        // The question wraps, so its rows are counted rather than its lines;
        // the filter line and a spacer follow it.
        let first = window_start(picker.selected, self.visible);
        let count = picker.shown().len().saturating_sub(first).min(self.visible);
        row_hits(hits, area, area.y + 1 + self.context_rows + 2, first, count);
        frame.render_widget(Clear, area);
        frame.render_widget(
            Paragraph::new(lines).wrap(Wrap { trim: false }).block(
                picker_block(picker, title, self.visible)
                    .border_style(warning)
                    .padding(Padding::horizontal(1)),
            ),
            area,
        );
    }
}

fn picker_block(picker: &Picker, title: Span<'static>, visible: usize) -> Block<'static> {
    let muted = Style::default().fg(brand::muted());
    let shown = picker.shown().len();
    let position = (shown > visible).then_some((picker.selected, shown));
    let hint = match picker.kind {
        PickerKind::Settings => " ↑↓ choose · Enter change · Esc close ",
        PickerKind::Question => " ↑↓ choose · Enter answer · Esc type instead ",
        _ => " ↑↓ choose · Enter select · Esc close ",
    };
    frame_block(title, Style::default().fg(brand::accent()), position)
        .title_bottom(Line::styled(hint, muted))
}

/// A picker's lines inside its border, `width` columns wide: the context, the
/// filter, then up to `visible` rows around the highlight.
fn picker_lines(
    picker: &Picker,
    context: Vec<Line<'static>>,
    width: u16,
    visible: usize,
) -> (Vec<Line<'static>>, usize) {
    let accent = Style::default().fg(brand::accent());
    let muted = Style::default().fg(brand::muted());
    let shown = picker.shown();
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
    let mut lines = context;
    if !lines.is_empty() && lines.last().is_some_and(|line| line.width() > 0) {
        lines.push(Line::raw(""));
    }
    lines.push(Line::from(if picker.filter.is_empty() {
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
    }));
    lines.push(Line::raw(""));
    let rows_from = lines.len();
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
    (lines, rows_from)
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

    #[test]
    fn a_docked_question_wraps_in_full_and_shows_every_option() {
        use crate::ui::pickers::{Action, Item};
        let question = "Which database should the new reporting service use for its \
                        nightly aggregates, given the existing Postgres cluster?";
        let picker = Picker {
            kind: PickerKind::Question,
            title: format!("{question}\nIt decides the migration plan."),
            items: ["Postgres", "SQLite", "DuckDB"]
                .iter()
                .map(|label| Item {
                    label: (*label).into(),
                    detail: String::new(),
                    action: Action::Dismiss,
                })
                .collect(),
            filter: String::new(),
            selected: 0,
            subject: None,
            checked: Vec::new(),
        };
        let area = Rect::new(0, 0, 50, 40);
        let dock = Docked::new(&picker, area.width, area.height / 2);
        let height = dock.height();
        assert!(height <= area.height / 2, "{height}");
        let mut terminal =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(area.width, height)).unwrap();
        terminal
            .draw(|frame| dock.draw(frame, &Hits::default(), &picker, frame.area()))
            .unwrap();
        let buffer = terminal.backend().buffer();
        let screen: String = (0..height)
            .map(|y| {
                (0..area.width)
                    .map(|x| buffer[(x, y)].symbol())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n");
        let words: String = screen
            .split(|c: char| c.is_whitespace() || c == '│')
            .filter(|word| !word.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(words.contains("Postgres cluster?"), "{screen}");
        assert!(words.contains("It decides the migration plan."), "{screen}");
        for option in ["Postgres", "SQLite", "DuckDB"] {
            assert!(screen.contains(option), "{screen}");
        }
    }
}
