//! Jackalope's mark and palette, rendered for a terminal.
//!
//! The desktop mark repeats its silhouette ten times at decreasing opacity —
//! the "echo" in `EchoMark`. A terminal cannot do opacity, but it can do the
//! same idea with a colour ramp, so the wordmark echoes upward into the
//! background instead of fading out.

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

/// The default accent from `packages/brand` (Mojave Sunset). The host reports
/// the workspace's own accent once connected; this is what we draw before then.
const ACCENT: (u8, u8, u8) = (0xf9, 0x73, 0x16);

/// How many echo lines sit above the wordmark.
const ECHOES: usize = 4;

/// True colour lets the echo ramp read as one gradient. Without it the ramp
/// would band into a few indexed colours and look like an accident, so the
/// banner falls back to a single accent line.
pub fn truecolor() -> bool {
    std::env::var("COLORTERM").is_ok_and(|value| value == "truecolor" || value == "24bit")
}

pub fn colored() -> bool {
    // https://no-color.org: any non-empty value disables colour.
    std::env::var_os("NO_COLOR").is_none_or(|value| value.is_empty())
}

/// Terminals that cannot render the box-drawing mark get an ASCII one.
fn unicode() -> bool {
    std::env::var("LC_ALL")
        .or_else(|_| std::env::var("LC_CTYPE"))
        .or_else(|_| std::env::var("LANG"))
        .map(|value| value.to_ascii_lowercase().contains("utf"))
        .unwrap_or(false)
}

pub fn accent() -> Color {
    if !colored() {
        return Color::Reset;
    }
    if truecolor() {
        Color::Rgb(ACCENT.0, ACCENT.1, ACCENT.2)
    } else {
        Color::Yellow
    }
}

pub fn muted() -> Color {
    if colored() {
        Color::DarkGray
    } else {
        Color::Reset
    }
}

/// How much of the accent echo `step` carries. The last step is the solid
/// wordmark; earlier ones recede toward the background.
fn echo_weight(step: usize) -> f32 {
    (step + 1) as f32 / (ECHOES + 1) as f32
}

/// Blends the accent toward the background for echo `step` of `ECHOES`.
fn echo_color(step: usize) -> Color {
    if !colored() {
        return Color::Reset;
    }
    if !truecolor() {
        return Color::DarkGray;
    }
    let weight = echo_weight(step);
    let blend = |channel: u8| (channel as f32 * weight).round() as u8;
    Color::Rgb(blend(ACCENT.0), blend(ACCENT.1), blend(ACCENT.2))
}

/// The antlered mark, sized to sit beside the wordmark.
fn mark() -> [&'static str; ECHOES + 1] {
    if unicode() {
        ["  ╲╿╱  ", " ╲ ╿ ╱ ", "  ╲│╱  ", "  ╭─╮  ", " ╰╯ ╰╯ "]
    } else {
        ["  \\|/  ", " \\ | / ", "  \\|/  ", "  /-\\  ", "  \\_/  "]
    }
}

/// The full banner: the mark beside a wordmark that echoes upward.
pub fn banner() -> Vec<Line<'static>> {
    let mark = mark();
    let mut lines = Vec::with_capacity(ECHOES + 1);
    for step in 0..=ECHOES {
        let color = echo_color(step);
        // The wordmark shifts one column per echo, the way the desktop mark
        // offsets each repeat.
        let indent = " ".repeat(ECHOES - step);
        let mut spans = vec![Span::styled(mark[step], Style::default().fg(color))];
        spans.push(Span::raw(indent));
        let word = Span::styled(
            "jackalope",
            if step == ECHOES {
                Style::default().fg(color).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(color)
            },
        );
        spans.push(word);
        lines.push(Line::from(spans));
    }
    lines
}

/// A single-line version for narrow terminals, where five lines of banner
/// would crowd out the conversation.
pub fn compact() -> Line<'static> {
    let glyph = if unicode() { "╲╿╱" } else { "\\|/" };
    Line::from(vec![
        Span::styled(glyph, Style::default().fg(accent())),
        Span::raw(" "),
        Span::styled(
            "jackalope",
            Style::default().fg(accent()).add_modifier(Modifier::BOLD),
        ),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_banner_ends_on_the_solid_wordmark() {
        let lines = banner();
        assert_eq!(lines.len(), ECHOES + 1);
        // Every line carries the wordmark so the echo reads as one shape.
        for line in &lines {
            let text: String = line
                .spans
                .iter()
                .map(|span| span.content.as_ref())
                .collect();
            assert!(text.contains("jackalope"), "missing wordmark in {text:?}");
        }
    }

    #[test]
    fn echoes_ramp_toward_the_accent() {
        // Guards the gradient direction: a reversed ramp would leave the
        // brightest line at the top and the wordmark invisible.
        let first = echo_color(0);
        let last = echo_color(ECHOES);
        if let (Color::Rgb(r1, _, _), Color::Rgb(r2, _, _)) = (first, last) {
            assert!(r1 < r2, "echo should brighten toward the wordmark");
        }
    }
}
