//! Selecting text by dragging. The interface captures the mouse to scroll
//! the conversation, so it selects and copies itself, from the drawn screen.

use super::App;
use crossterm::event::{MouseEvent, MouseEventKind};
use ratatui::buffer::Buffer;

/// A drag across the screen, in screen cells, from where it started to
/// where the pointer is now.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Selection {
    anchor: (u16, u16),
    head: (u16, u16),
}

impl Selection {
    /// Start and end in reading order, as (column, row).
    fn ordered(&self) -> ((u16, u16), (u16, u16)) {
        let key = |(column, row): (u16, u16)| (row, column);
        if key(self.anchor) <= key(self.head) {
            (self.anchor, self.head)
        } else {
            (self.head, self.anchor)
        }
    }

    pub fn contains(&self, column: u16, row: u16) -> bool {
        let ((start_column, start_row), (end_column, end_row)) = self.ordered();
        (start_row..=end_row).contains(&row)
            && (row != start_row || column >= start_column)
            && (row != end_row || column <= end_column)
    }
}

/// The text under a selection on the drawn screen, one line per row with
/// trailing blanks removed.
fn selected_text(screen: &Buffer, selection: &Selection) -> String {
    let ((start_column, start_row), (end_column, end_row)) = selection.ordered();
    let area = screen.area;
    let mut rows = Vec::new();
    for row in start_row..=end_row.min(area.bottom().saturating_sub(1)) {
        let from = if row == start_row {
            start_column
        } else {
            area.left()
        };
        let to = if row == end_row {
            end_column.min(area.right().saturating_sub(1))
        } else {
            area.right().saturating_sub(1)
        };
        let mut text = String::new();
        for column in from..=to {
            if let Some(cell) = screen.cell((column, row)) {
                text.push_str(cell.symbol());
            }
        }
        rows.push(text.trim_end().to_string());
    }
    rows.join("\n")
}

impl App {
    /// Selection by dragging, the way a terminal would, then copying on release.
    pub(super) fn select(&mut self, mouse: MouseEvent) {
        if self.picker.is_some() {
            return;
        }
        let at = (mouse.column, mouse.row);
        match mouse.kind {
            MouseEventKind::Down(_) => {
                self.selection = Some(Selection {
                    anchor: at,
                    head: at,
                })
            }
            MouseEventKind::Drag(_) => {
                if let Some(selection) = self.selection.as_mut() {
                    selection.head = at;
                }
            }
            MouseEventKind::Up(_) => {
                let Some(selection) = self.selection.as_mut() else {
                    return;
                };
                selection.head = at;
                let selection = *selection;
                if selection.anchor == selection.head {
                    // A click, not a drag.
                    self.selection = None;
                    return;
                }
                let text = self
                    .screen
                    .as_ref()
                    .map(|screen| selected_text(screen, &selection))
                    .unwrap_or_default();
                if !text.trim().is_empty() {
                    self.copy(&text);
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::layout::Rect;
    use ratatui::style::Style;

    #[test]
    fn a_selection_reads_the_screen_in_order_and_trims_rows() {
        let mut screen = Buffer::empty(Rect::new(0, 0, 8, 3));
        screen.set_string(0, 0, "alpha", Style::default());
        screen.set_string(0, 1, "bravo", Style::default());
        screen.set_string(0, 2, "charlie", Style::default());
        // Dragged upward from "char" back to "pha": still reads top to bottom.
        let selection = Selection {
            anchor: (3, 2),
            head: (2, 0),
        };
        assert_eq!(selected_text(&screen, &selection), "pha\nbravo\nchar");
        assert!(selection.contains(7, 1));
        assert!(!selection.contains(1, 0));
        assert!(!selection.contains(4, 2));
    }
}
