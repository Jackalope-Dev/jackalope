//! The draft being typed: its text, the cursor (in characters), readline-style
//! editing and the soft-wrapped layout it is drawn with.

use unicode_width::UnicodeWidthChar;

#[derive(Default)]
pub struct Editor {
    text: String,
    /// Cursor position in `text`, in characters.
    cursor: usize,
    /// Text removed by Esc, Ctrl+K, Ctrl+U or Ctrl+W, for Ctrl+Y.
    killed: String,
}

impl Editor {
    pub fn text(&self) -> &str {
        &self.text
    }

    pub fn cursor(&self) -> usize {
        self.cursor
    }

    pub fn len(&self) -> usize {
        self.text.chars().count()
    }

    pub fn is_empty(&self) -> bool {
        self.text.is_empty()
    }

    /// Replaces the draft, with the cursor at its end.
    pub fn set(&mut self, text: String) {
        self.cursor = text.chars().count();
        self.text = text;
    }

    /// Empties the draft and returns what it held.
    pub fn take(&mut self) -> String {
        self.cursor = 0;
        std::mem::take(&mut self.text)
    }

    /// Clears the draft so Ctrl+Y can bring it back.
    pub fn clear_undoably(&mut self) {
        if !self.text.is_empty() {
            self.killed = self.take();
        }
    }

    pub fn set_cursor(&mut self, at: usize) {
        self.cursor = at.min(self.len());
    }

    pub fn char_before(&self) -> Option<char> {
        self.cursor
            .checked_sub(1)
            .and_then(|index| self.text.chars().nth(index))
    }

    /// Byte offset of character `index`.
    fn byte(&self, index: usize) -> usize {
        self.text
            .char_indices()
            .nth(index)
            .map_or(self.text.len(), |(offset, _)| offset)
    }

    pub fn insert(&mut self, text: &str) {
        let at = self.byte(self.cursor);
        self.text.insert_str(at, text);
        self.cursor += text.chars().count();
    }

    /// Deletes between `start` and the cursor (either order), leaving the
    /// cursor where the removed text began.
    pub fn delete_to(&mut self, start: usize) {
        let start = start.min(self.len());
        let (from, to) = (start.min(self.cursor), start.max(self.cursor));
        let (from_byte, to_byte) = (self.byte(from), self.byte(to));
        self.text.replace_range(from_byte..to_byte, "");
        self.cursor = from;
    }

    /// Deletes between the cursor and `other`, keeping it for Ctrl+Y.
    pub fn kill_to(&mut self, other: usize) {
        let other = other.min(self.len());
        let (from, to) = (other.min(self.cursor), other.max(self.cursor));
        let removed: String = self.text.chars().skip(from).take(to - from).collect();
        if !removed.is_empty() {
            self.killed = removed;
        }
        self.cursor = to;
        self.delete_to(from);
    }

    pub fn yank(&mut self) {
        let text = self.killed.clone();
        self.insert(&text);
    }

    pub fn backspace(&mut self) {
        if self.cursor > 0 {
            self.delete_to(self.cursor - 1);
        }
    }

    pub fn delete_forward(&mut self) {
        if self.cursor < self.len() {
            self.cursor += 1;
            self.delete_to(self.cursor - 1);
        }
    }

    /// Start of the logical line the cursor is on.
    pub fn line_start(&self) -> usize {
        let before: Vec<char> = self.text.chars().take(self.cursor).collect();
        before
            .iter()
            .rposition(|character| *character == '\n')
            .map_or(0, |at| at + 1)
    }

    pub fn line_end(&self) -> usize {
        self.text
            .chars()
            .skip(self.cursor)
            .position(|character| character == '\n')
            .map_or(self.len(), |offset| self.cursor + offset)
    }

    pub fn word_start(&self) -> usize {
        let characters: Vec<char> = self.text.chars().collect();
        let mut index = self.cursor;
        while index > 0 && characters[index - 1].is_whitespace() {
            index -= 1;
        }
        while index > 0 && !characters[index - 1].is_whitespace() {
            index -= 1;
        }
        index
    }

    pub fn word_end(&self) -> usize {
        let characters: Vec<char> = self.text.chars().collect();
        let mut index = self.cursor;
        while index < characters.len() && characters[index].is_whitespace() {
            index += 1;
        }
        while index < characters.len() && !characters[index].is_whitespace() {
            index += 1;
        }
        index
    }

    /// Moves the cursor one visual row up or down at `width` columns, keeping
    /// its column where the row is long enough. False at the first or last row.
    pub fn move_row(&mut self, direction: i32, width: u16) -> bool {
        let layout = Layout::new(&self.text, width);
        let (row, column) = layout.positions[self.cursor];
        let target = row as i32 + direction;
        if target < 0 || target as usize >= layout.rows.len() {
            return false;
        }
        let target = target as usize;
        // The last position on the target row at or before the column.
        self.cursor = layout
            .positions
            .iter()
            .enumerate()
            .filter(|(_, (candidate, at))| *candidate == target && *at <= column)
            .map(|(index, _)| index)
            .next_back()
            .or_else(|| {
                layout
                    .positions
                    .iter()
                    .position(|(candidate, _)| *candidate == target)
            })
            .unwrap_or(self.cursor);
        true
    }
}

/// The draft laid out the way it is drawn: soft-wrapped at word boundaries
/// to `width` columns, with the (row, column) of every cursor position.
pub struct Layout {
    pub rows: Vec<String>,
    /// One entry per character plus the end of the text.
    pub positions: Vec<(usize, usize)>,
}

impl Layout {
    pub fn new(text: &str, width: u16) -> Self {
        let width = width.max(2) as usize;
        let characters: Vec<char> = text.chars().collect();
        let mut rows = Vec::new();
        let mut positions = vec![(0, 0); characters.len() + 1];
        let (mut row, mut column, mut row_start) = (0, 0, 0);
        // Where the row may break: just after its latest space.
        let mut last_break: Option<usize> = None;
        let mut index = 0;
        while index < characters.len() {
            let character = characters[index];
            if character == '\n' {
                positions[index] = (row, column);
                rows.push(characters[row_start..index].iter().collect());
                row += 1;
                index += 1;
                (row_start, column, last_break) = (index, 0, None);
                continue;
            }
            let character_width = character.width().unwrap_or(0);
            if column + character_width > width && column > 0 {
                // Carry the partial word down when the row has a space to
                // break at; otherwise break mid-word, as a terminal would.
                let end = last_break.filter(|at| *at > row_start).unwrap_or(index);
                rows.push(characters[row_start..end].iter().collect());
                row += 1;
                (row_start, column, last_break, index) = (end, 0, None, end);
                continue;
            }
            positions[index] = (row, column);
            column += character_width;
            if character == ' ' {
                last_break = Some(index + 1);
            }
            index += 1;
        }
        rows.push(characters[row_start..].iter().collect());
        positions[characters.len()] = if column >= width {
            // A full last row puts the cursor at the start of the next.
            rows.push(String::new());
            (row + 1, 0)
        } else {
            (row, column)
        };
        Layout { rows, positions }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn editor(text: &str, cursor: usize) -> Editor {
        let mut editor = Editor::default();
        editor.set(text.into());
        editor.set_cursor(cursor);
        editor
    }

    #[test]
    fn the_draft_wraps_at_words_and_tracks_the_cursor() {
        let layout = Layout::new("fix the flaky test", 10);
        // The second row is full, so the cursor after it starts a third.
        assert_eq!(layout.rows, ["fix the ", "flaky test", ""]);
        // "flaky" moved down whole, so its first letter starts the row.
        assert_eq!(layout.positions[8], (1, 0));
        assert_eq!(layout.positions[18], (2, 0));
        // A word longer than the row breaks where it must.
        let long = Layout::new("abcdefghij", 4);
        assert_eq!(long.rows, ["abcd", "efgh", "ij"]);
        assert_eq!(long.positions[10], (2, 2));
        // Explicit newlines start rows; a full row moves the end cursor down.
        let lines = Layout::new("ab\ncd", 2);
        assert_eq!(lines.rows, ["ab", "cd", ""]);
        assert_eq!(lines.positions[5], (2, 0));
        // Wide characters take two columns.
        let wide = Layout::new("日本語", 4);
        assert_eq!(wide.rows, ["日本", "語"]);
        assert_eq!(Layout::new("", 8).rows, [""]);
    }

    #[test]
    fn words_and_lines_bound_cursor_motion() {
        let text = "one two\nthree four";
        let mut draft = editor(text, 11);
        assert_eq!(draft.word_start(), 8);
        assert_eq!(draft.word_end(), 13);
        assert_eq!(draft.line_start(), 8);
        assert_eq!(draft.line_end(), 18);
        draft.set_cursor(3);
        assert_eq!(draft.line_start(), 0);
        assert_eq!(draft.line_end(), 7);
        draft.set_cursor(99);
        assert_eq!(draft.cursor(), 18, "the cursor stays inside the text");
    }

    #[test]
    fn killed_text_comes_back_with_yank() {
        let mut draft = editor("deploy the thing", 16);
        draft.kill_to(draft.word_start());
        assert_eq!(draft.text(), "deploy the ");
        draft.set_cursor(0);
        draft.yank();
        assert_eq!(draft.text(), "thingdeploy the ");
        draft.clear_undoably();
        assert!(draft.is_empty());
        draft.yank();
        assert_eq!(draft.text(), "thingdeploy the ");
    }

    #[test]
    fn editing_counts_characters_not_bytes() {
        let mut draft = editor("héllo", 1);
        draft.insert("ü");
        assert_eq!(draft.text(), "hüéllo");
        assert_eq!(draft.char_before(), Some('ü'));
        draft.backspace();
        draft.delete_forward();
        assert_eq!(draft.text(), "hllo");
        assert_eq!(draft.cursor(), 1);
    }

    #[test]
    fn rows_move_between_wrapped_lines() {
        let mut draft = editor("ab\ncdef", 6);
        assert!(draft.move_row(-1, 20));
        assert_eq!(draft.cursor(), 2, "end of the shorter row above");
        assert!(!draft.move_row(-1, 20));
        assert!(draft.move_row(1, 20));
        assert_eq!(draft.cursor(), 5);
    }
}
