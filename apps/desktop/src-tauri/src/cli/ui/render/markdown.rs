//! A small Markdown renderer for agent replies: headings, lists, quotes, code
//! blocks, links, and inline `code`, **bold** and *emphasis*. Anything else is
//! shown as written, which is how Markdown reads anyway.

use crate::brand;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};

/// Terminals draw tabs at inconsistent widths; spaces measure predictably.
fn expand_tabs(text: &str) -> String {
    text.replace('\t', "    ")
}

pub fn markdown(text: &str) -> Vec<Line<'static>> {
    let accent = Style::default().fg(brand::accent());
    let muted = Style::default().fg(brand::muted());
    let mut lines = Vec::new();
    let mut in_code = false;
    for raw in text.lines() {
        let raw = expand_tabs(raw);
        let trimmed = raw.trim_start();
        if trimmed.starts_with("```") {
            in_code = !in_code;
            if in_code {
                let language = trimmed.trim_start_matches('`').trim();
                let language = if language.is_empty() {
                    "code"
                } else {
                    language
                };
                lines.push(Line::styled(format!("  ┌ {language}"), muted));
            } else {
                lines.push(Line::styled("  └", muted));
            }
            continue;
        }
        if in_code {
            lines.push(Line::from(vec![
                Span::styled("  │ ", muted),
                Span::styled(raw.clone(), accent),
            ]));
            continue;
        }
        let indent = " ".repeat(raw.len() - trimmed.len());
        if let Some(heading) = heading(trimmed) {
            lines.push(Line::styled(
                heading.to_string(),
                accent.add_modifier(Modifier::BOLD),
            ));
        } else if let Some(item) = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
            .or_else(|| trimmed.strip_prefix("+ "))
        {
            let mut spans = vec![Span::raw(format!("{indent}  ")), Span::styled("• ", accent)];
            spans.extend(inline(item));
            lines.push(Line::from(spans));
        } else if let Some((number, item)) = numbered(trimmed) {
            let mut spans = vec![
                Span::raw(format!("{indent}  ")),
                Span::styled(format!("{number} "), accent),
            ];
            spans.extend(inline(item));
            lines.push(Line::from(spans));
        } else if let Some(quote) = trimmed.strip_prefix("> ").or_else(|| {
            // An empty quoted line.
            (trimmed == ">").then_some("")
        }) {
            let mut spans = vec![Span::styled("  ▎ ", muted)];
            spans.extend(
                inline(quote)
                    .into_iter()
                    .map(|span| span.patch_style(muted)),
            );
            lines.push(Line::from(spans));
        } else if trimmed.len() >= 3 && trimmed.chars().all(|c| matches!(c, '-' | '*' | '_')) {
            lines.push(Line::styled("  ⠒⠒⠒", muted));
        } else {
            let mut spans = vec![Span::raw(indent)];
            spans.extend(inline(trimmed));
            lines.push(Line::from(spans));
        }
    }
    lines
}

/// `# Title` through `###### Title`.
fn heading(line: &str) -> Option<&str> {
    let level = line.chars().take_while(|c| *c == '#').count();
    (1..=6).contains(&level).then_some(())?;
    line[level..].strip_prefix(' ')
}

/// `1. item` or `1) item`, as the marker and the item.
fn numbered(line: &str) -> Option<(&str, &str)> {
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    if digits == 0 || digits > 9 {
        return None;
    }
    let rest = &line[digits..];
    let item = rest
        .strip_prefix(". ")
        .or_else(|| rest.strip_prefix(") "))?;
    Some((&line[..digits + 1], item))
}

/// Where a single-character emphasis marker opened at the start of `after`
/// (the text following it) closes: a matching marker that follows a non-space
/// and is not inside a word. `None` when there is no such marker.
fn emphasis_end(after: &str, marker: char) -> Option<usize> {
    if after.chars().next().is_none_or(char::is_whitespace) {
        return None;
    }
    let characters: Vec<(usize, char)> = after.char_indices().collect();
    characters
        .iter()
        .enumerate()
        .find_map(|(index, (at, character))| {
            let closes = *character == marker
                && index > 0
                && !characters[index - 1].1.is_whitespace()
                && characters
                    .get(index + 1)
                    .is_none_or(|(_, next)| !next.is_alphanumeric() && *next != marker);
            closes.then_some(*at)
        })
}

/// `[text](url)` at the start of `rest`, as (text, url, bytes consumed).
fn link(rest: &str) -> Option<(&str, &str, usize)> {
    let close = rest.find("](")?;
    let text = &rest[1..close];
    let url_start = close + 2;
    let url_end = url_start + rest[url_start..].find(')')?;
    let url = &rest[url_start..url_end];
    (!text.is_empty() && !text.contains('[') && !url.contains(char::is_whitespace)).then_some((
        text,
        url,
        url_end + 1,
    ))
}

/// Inline Markdown: `code`, **bold**, *emphasis* and [links](url).
pub fn inline(text: &str) -> Vec<Span<'static>> {
    let accent = Style::default().fg(brand::accent());
    let muted = Style::default().fg(brand::muted());
    let mut spans = Vec::new();
    let mut plain = String::new();
    let mut rest = text;
    let mut previous: Option<char> = None;
    let flush = |plain: &mut String, spans: &mut Vec<Span<'static>>| {
        if !plain.is_empty() {
            spans.push(Span::raw(std::mem::take(plain)));
        }
    };
    while let Some(character) = rest.chars().next() {
        // Code first: nothing inside it is Markdown.
        if character == '`' {
            if let Some(end) = rest[1..].find('`').filter(|end| *end > 0) {
                flush(&mut plain, &mut spans);
                spans.push(Span::styled(rest[1..1 + end].to_string(), accent));
                rest = &rest[end + 2..];
                previous = Some('`');
                continue;
            }
        }
        if rest.starts_with("**") {
            let inner_end = rest[2..].find("**").filter(|end| {
                let inner = &rest[2..2 + end];
                !inner.is_empty() && inner.trim() == inner
            });
            if let Some(end) = inner_end {
                flush(&mut plain, &mut spans);
                spans.push(Span::styled(
                    rest[2..2 + end].to_string(),
                    Style::default().add_modifier(Modifier::BOLD),
                ));
                rest = &rest[end + 4..];
                previous = Some('*');
                continue;
            }
        }
        // A single marker opens emphasis only at the start of a word, so
        // snake_case names and arithmetic stay as written.
        // A doubled marker (`__init__`) is part of the text too.
        let opens = (character == '*' || character == '_')
            && previous.is_none_or(|previous| !previous.is_alphanumeric() && previous != character)
            && rest[1..].chars().next() != Some(character);
        if opens {
            if let Some(end) = emphasis_end(&rest[1..], character) {
                flush(&mut plain, &mut spans);
                spans.push(Span::styled(
                    rest[1..1 + end].to_string(),
                    Style::default().add_modifier(Modifier::ITALIC),
                ));
                rest = &rest[end + 2..];
                previous = Some(character);
                continue;
            }
        }
        if character == '[' {
            if let Some((label, url, consumed)) = link(rest) {
                flush(&mut plain, &mut spans);
                spans.push(Span::styled(
                    label.to_string(),
                    accent.add_modifier(Modifier::UNDERLINED),
                ));
                if url != label {
                    spans.push(Span::styled(format!(" ({url})"), muted));
                }
                rest = &rest[consumed..];
                previous = Some(')');
                continue;
            }
        }
        plain.push(character);
        previous = Some(character);
        rest = &rest[character.len_utf8()..];
    }
    flush(&mut plain, &mut spans);
    spans
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

    fn shown(text: &str) -> String {
        inline(text)
            .iter()
            .map(|span| span.content.as_ref())
            .collect()
    }

    #[test]
    fn inline_markdown_styles_code_bold_and_emphasis() {
        let spans = inline("run `cargo test` then **ship** it _now_");
        assert_eq!(
            shown("run `cargo test` then **ship** it _now_"),
            "run cargo test then ship it now"
        );
        let bold = spans.iter().find(|span| span.content == "ship").unwrap();
        assert!(bold.style.add_modifier.contains(Modifier::BOLD));
        let now = spans.iter().find(|span| span.content == "now").unwrap();
        assert!(now.style.add_modifier.contains(Modifier::ITALIC));
        // An unmatched marker is left as written.
        assert_eq!(shown("2 * 3 = 6"), "2 * 3 = 6");
    }

    #[test]
    fn markers_inside_words_and_arithmetic_stay_as_written() {
        assert_eq!(shown("edit my_file_name.rs"), "edit my_file_name.rs");
        assert_eq!(shown("call __init__ now"), "call __init__ now");
        assert_eq!(shown("2 * 3 * 4 = 24"), "2 * 3 * 4 = 24");
        assert_eq!(shown("a*b*c"), "a*b*c");
        assert_eq!(
            shown("see `snake_case` and *this*"),
            "see snake_case and this"
        );
    }

    #[test]
    fn links_show_their_text_and_address() {
        assert_eq!(
            shown("read [the guide](https://x.dev/guide) first"),
            "read the guide (https://x.dev/guide) first"
        );
        assert_eq!(shown("[x](x)"), "x");
        assert_eq!(shown("[not a link]"), "[not a link]");
    }

    #[test]
    fn markdown_frames_code_and_marks_lists() {
        let lines = markdown("# Plan\n- one\n```rust\nlet x = 1;\n```");
        let shown: Vec<String> = lines.iter().map(text).collect();
        assert_eq!(shown[0], "Plan");
        assert!(shown[1].contains("• one"));
        assert!(shown[2].contains("rust"));
        assert!(shown[3].ends_with("let x = 1;"));
        assert_eq!(lines.len(), 5);
    }

    #[test]
    fn deeper_headings_numbers_and_tabs_render() {
        let lines = markdown("#### Deep\n2. second\n10) tenth\n```\n\tindented\n```\n#hashtag");
        let shown: Vec<String> = lines.iter().map(text).collect();
        assert_eq!(shown[0], "Deep");
        assert_eq!(shown[1], "  2. second");
        assert_eq!(shown[2], "  10) tenth");
        assert!(shown[4].ends_with("    indented"));
        assert_eq!(shown[6], "#hashtag", "a heading needs its space");
    }
}
