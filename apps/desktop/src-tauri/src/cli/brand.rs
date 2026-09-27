//! Jackalope's mark and palette, rendered for a terminal.
//!
//! The desktop mark repeats its silhouette ten times at decreasing opacity —
//! the "echo" in `EchoMark`. A terminal cannot do opacity, but it can do the
//! same idea with a colour ramp, so the wordmark echoes upward into the
//! background instead of fading out.

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

/// The default accent from `packages/brand` (Mojave Sunset), drawn until the
/// project's own colour is known and for projects the app has not themed.
const DEFAULT_ACCENT: (u8, u8, u8) = (0xf9, 0x73, 0x16);

/// The accent in use: the project's colour, adjusted to read on this terminal.
static ACCENT: std::sync::RwLock<Option<(u8, u8, u8)>> = std::sync::RwLock::new(None);

fn current_accent() -> (u8, u8, u8) {
    ACCENT
        .read()
        .ok()
        .and_then(|accent| *accent)
        .unwrap_or_else(|| readable(DEFAULT_ACCENT, background()))
}

/// Wears the project's colour (`#rrggbb`), or the brand default when absent.
pub fn set_accent(hex: Option<&str>) {
    let color = hex.and_then(parse_hex).unwrap_or(DEFAULT_ACCENT);
    if let Ok(mut accent) = ACCENT.write() {
        *accent = Some(readable(color, background()));
    }
}

fn parse_hex(hex: &str) -> Option<(u8, u8, u8)> {
    let hex = hex.strip_prefix('#')?;
    if !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let expanded: String = match hex.len() {
        3 => hex.chars().flat_map(|c| [c, c]).collect(),
        6 => hex.into(),
        _ => return None,
    };
    let channel = |at: usize| u8::from_str_radix(&expanded[at..at + 2], 16).ok();
    Some((channel(0)?, channel(2)?, channel(4)?))
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Background {
    Dark,
    Light,
    Unknown,
}

/// The terminal's background, when it says. Many terminals export
/// `COLORFGBG` as `foreground;background` in ANSI indexes; 0–6 and 8 are dark.
fn background() -> Background {
    let Ok(value) = std::env::var("COLORFGBG") else {
        return Background::Unknown;
    };
    match value
        .rsplit(';')
        .next()
        .and_then(|index| index.parse::<u8>().ok())
    {
        Some(0..=6 | 8) => Background::Dark,
        Some(_) => Background::Light,
        None => Background::Unknown,
    }
}

/// WCAG relative luminance.
fn luminance((r, g, b): (u8, u8, u8)) -> f64 {
    let linear = |channel: u8| {
        let value = channel as f64 / 255.0;
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

#[cfg(test)]
fn contrast(a: f64, b: f64) -> f64 {
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}

/// Typical terminal grounds: a dark editor grey and white.
const DARK_GROUND: f64 = 0.0137; // #1e1e1e
const LIGHT_GROUND: f64 = 1.0;

/// The luminance range an accent must fall in to read on `background`. With a
/// known ground the accent reaches 4.5:1 (WCAG AA for text); when unknown it
/// keeps 3:1 (AA for interface marks) against both dark and light grounds.
fn target(background: Background) -> (f64, f64) {
    let at_least = |ratio: f64| ratio * (DARK_GROUND + 0.05) - 0.05;
    let at_most = |ratio: f64| (LIGHT_GROUND + 0.05) / ratio - 0.05;
    match background {
        Background::Dark => (at_least(4.5), 1.0),
        Background::Light => (0.0, at_most(4.5)),
        Background::Unknown => (at_least(3.0), at_most(3.0)),
    }
}

/// The colour with its hue and saturation kept and its lightness moved just far
/// enough to fall inside the readable range, so a pale or very dark project
/// colour stays recognisably itself without disappearing into the background.
fn readable(color: (u8, u8, u8), background: Background) -> (u8, u8, u8) {
    let (low, high) = target(background);
    let current = luminance(color);
    if (low..=high).contains(&current) {
        return color;
    }
    let (hue, saturation, _) = to_hsl(color);
    // Luminance rises with lightness, so bisect lightness toward the edge.
    let goal = if current < low { low } else { high };
    let (mut darker, mut lighter) = (0.0_f64, 1.0_f64);
    for _ in 0..40 {
        let middle = (darker + lighter) / 2.0;
        if luminance(from_hsl(hue, saturation, middle)) < goal {
            darker = middle;
        } else {
            lighter = middle;
        }
    }
    from_hsl(
        hue,
        saturation,
        if current < low { lighter } else { darker },
    )
}

fn to_hsl((r, g, b): (u8, u8, u8)) -> (f64, f64, f64) {
    let (r, g, b) = (r as f64 / 255.0, g as f64 / 255.0, b as f64 / 255.0);
    let (max, min) = (r.max(g).max(b), r.min(g).min(b));
    let lightness = (max + min) / 2.0;
    if max == min {
        return (0.0, 0.0, lightness);
    }
    let delta = max - min;
    let saturation = delta / (1.0 - (2.0 * lightness - 1.0).abs());
    let hue = if max == r {
        ((g - b) / delta).rem_euclid(6.0)
    } else if max == g {
        (b - r) / delta + 2.0
    } else {
        (r - g) / delta + 4.0
    } * 60.0;
    (hue, saturation, lightness)
}

fn from_hsl(hue: f64, saturation: f64, lightness: f64) -> (u8, u8, u8) {
    let chroma = (1.0 - (2.0 * lightness - 1.0).abs()) * saturation;
    let x = chroma * (1.0 - ((hue / 60.0).rem_euclid(2.0) - 1.0).abs());
    let (r, g, b) = match (hue / 60.0) as u32 {
        0 => (chroma, x, 0.0),
        1 => (x, chroma, 0.0),
        2 => (0.0, chroma, x),
        3 => (0.0, x, chroma),
        4 => (x, 0.0, chroma),
        _ => (chroma, 0.0, x),
    };
    let offset = lightness - chroma / 2.0;
    let channel = |value: f64| ((value + offset).clamp(0.0, 1.0) * 255.0).round() as u8;
    (channel(r), channel(g), channel(b))
}

/// The nearest of the basic ANSI hues, for terminals without true colour. The
/// terminal's own palette then keeps it legible on its background.
fn basic((r, g, b): (u8, u8, u8)) -> Color {
    let (hue, saturation, _) = to_hsl((r, g, b));
    if saturation < 0.15 {
        return Color::Gray;
    }
    match hue as u32 {
        0..=19 | 330..=360 => Color::Red,
        20..=69 => Color::Yellow,
        70..=159 => Color::Green,
        160..=199 => Color::Cyan,
        200..=259 => Color::Blue,
        _ => Color::Magenta,
    }
}

/// Use the fixed xterm palette instead of the terminal's six configurable hues.
fn indexed(color: (u8, u8, u8)) -> Color {
    let distance = |candidate: (u8, u8, u8)| {
        let channel = |a: u8, b: u8| (i32::from(a) - i32::from(b)).pow(2);
        channel(color.0, candidate.0)
            + channel(color.1, candidate.1)
            + channel(color.2, candidate.2)
    };
    let palette = |index: u8| {
        if index >= 232 {
            let level = 8 + 10 * (index - 232);
            (level, level, level)
        } else {
            let index = index - 16;
            let level = |value: u8| if value == 0 { 0 } else { 55 + value * 40 };
            (level(index / 36), level((index / 6) % 6), level(index % 6))
        }
    };
    Color::Indexed(
        (16..=255)
            .min_by_key(|index| distance(palette(*index)))
            .unwrap_or(16),
    )
}

/// How many echo lines sit above the wordmark.
const ECHOES: usize = 4;

/// Rows in the mark. The wordmark and its echoes sit beside the lower rows.
const MARK_ROWS: usize = 8;

/// The row (from the top of the mark) the solid wordmark sits on.
const WORDMARK_ROW: usize = 5;

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

/// Whether to draw with Braille dots. Nearly every current terminal can; the
/// exceptions are the Linux text console and legacy Windows console hosts, so
/// the check trusts a UTF-8 locale or a terminal known to render Unicode, and
/// `JACKALOPE_ASCII=1` forces plain characters for anything else.
pub fn unicode() -> bool {
    if crate::prefs::env_flag("JACKALOPE_ASCII") == Some(true) {
        return false;
    }
    if std::env::var("TERM").is_ok_and(|term| term == "linux") {
        return false;
    }
    let utf8_locale = std::env::var("LC_ALL")
        .or_else(|_| std::env::var("LC_CTYPE"))
        .or_else(|_| std::env::var("LANG"))
        .is_ok_and(|value| value.to_ascii_lowercase().contains("utf"));
    // Windows rarely sets a locale variable, but these hosts render Unicode.
    let modern_host = std::env::var_os("WT_SESSION").is_some()
        || std::env::var_os("TERM_PROGRAM").is_some()
        || std::env::var_os("WEZTERM_PANE").is_some()
        || std::env::var_os("ALACRITTY_WINDOW_ID").is_some();
    utf8_locale || modern_host
}

/// Frames for the working indicator: dots circling a Braille cell.
pub fn spinner(tick: usize) -> &'static str {
    const DOTS: [&str; 8] = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
    const PLAIN: [&str; 4] = ["|", "/", "-", "\\"];
    if unicode() {
        DOTS[tick % DOTS.len()]
    } else {
        PLAIN[tick % PLAIN.len()]
    }
}

/// The small marks used through the interface, drawn in the logo's dot style.
pub enum Mark {
    /// Fully usable.
    Full,
    /// Present but not confirmed ready.
    Partial,
    /// Needs the user.
    Attention,
    /// Absent.
    Empty,
    /// The highlighted row in a list.
    Cursor,
}

pub fn mark_glyph(mark: Mark) -> &'static str {
    let (dots, plain) = match mark {
        Mark::Full => ("⣿", "#"),
        Mark::Partial => ("⣤", "+"),
        Mark::Attention => ("⠿", "!"),
        Mark::Empty => ("⠄", "."),
        Mark::Cursor => ("⣿", ">"),
    };
    if unicode() {
        dots
    } else {
        plain
    }
}

/// A dotted rule across `width` columns.
pub fn divider(width: u16) -> Line<'static> {
    let dot = if unicode() { "⠒" } else { "-" };
    Line::styled(dot.repeat(width as usize), Style::default().fg(muted()))
}

/// The shared fallback chain: the tone adjusted to the terminal's ground,
/// then true colour, the 256-colour palette, or the basic ANSI set.
fn tone(color: (u8, u8, u8), basic: Color) -> Color {
    let (r, g, b) = readable(color, background());
    if truecolor() {
        Color::Rgb(r, g, b)
    } else if std::env::var("TERM").is_ok_and(|term| term.contains("256color")) {
        indexed((r, g, b))
    } else {
        basic
    }
}

/// The project's accent, adjusted to read on this terminal; Reset when colour
/// is disabled.
pub fn accent() -> Color {
    if !colored() {
        return Color::Reset;
    }
    tone(current_accent(), basic(current_accent()))
}

pub fn muted() -> Color {
    if colored() {
        Color::DarkGray
    } else {
        Color::Reset
    }
}

/// Completed work and confirmed input.
pub fn success() -> Color {
    if !colored() {
        return Color::Reset;
    }
    tone((0x2e, 0xbc, 0x7e), Color::Green)
}

/// Work that needs attention: an open question, a sign-in, a stalled action.
pub fn warning() -> Color {
    if !colored() {
        return Color::Reset;
    }
    tone((0xf5, 0x9e, 0x0b), Color::Yellow)
}

/// Failures and errors.
pub fn danger() -> Color {
    if !colored() {
        return Color::Reset;
    }
    tone((0xe5, 0x48, 0x4d), Color::Red)
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
    let (r, g, b) = current_accent();
    // Echoes recede toward the ground: black on dark terminals, white on light.
    let ground = if background() == Background::Light {
        255.0
    } else {
        0.0
    };
    let blend = |channel: u8| (ground + (channel as f32 - ground) * weight).round() as u8;
    Color::Rgb(blend(r), blend(g), blend(b))
}

/// The jackalope head from `packages/brand` (`characterPaths`: ears, antler and
/// head, as `EchoMark` draws it), rasterized onto a 2×4 dot grid per cell so it
/// keeps the logo's silhouette rather than approximating it with line art.
fn mark() -> [&'static str; MARK_ROWS] {
    if unicode() {
        [
            "⢀⣤⣀  ⣼⣿⡄  ⢠⡄⢀   ",
            "⠘⣿⣿⣷⡀⣿⣿⡇  ⣼⡿⠟⠁  ",
            " ⠘⣿⣿⣿⣿⣿⡇ ⣼⡟⣀⡀   ",
            "  ⠈⠻⣿⣿⣿⣧⣼⡿⠛⠛⠁   ",
            "    ⣿⣿⣿⣿⣿⣿⣆     ",
            "    ⠸⣿⣿⣿⣿⣿⣿⣿⣶⡄  ",
            "   ⢀⣠⣿⣿⣿⣿⡿⠿⠿⠋   ",
            "    ⠙⠿⢿⣿⡇       ",
        ]
    } else {
        [
            ".o.  ##.  ...   ",
            ".###.##o  ##o.  ",
            " .#####o ##..   ",
            "  .o######oo.   ",
            "    ######o     ",
            "    o########.  ",
            "   .o#######o   ",
            "    o###o       ",
        ]
    }
}

/// The full banner: the mark beside a wordmark that echoes upward, with the
/// version underneath.
pub fn banner() -> Vec<Line<'static>> {
    let mark = mark();
    let first_echo = WORDMARK_ROW - ECHOES;
    let mark_style = Style::default().fg(accent());
    let mut lines = Vec::with_capacity(MARK_ROWS);
    for (row, glyphs) in mark.iter().enumerate() {
        let mut spans = vec![
            Span::raw(" "),
            Span::styled(*glyphs, mark_style),
            Span::raw("  "),
        ];
        if (first_echo..=WORDMARK_ROW).contains(&row) {
            let step = row - first_echo;
            let color = echo_color(step);
            // The wordmark shifts one column per echo, the way the desktop mark
            // offsets each repeat.
            spans.push(Span::raw(" ".repeat(ECHOES - step)));
            spans.push(Span::styled(
                "jackalope",
                if step == ECHOES {
                    Style::default().fg(color).add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(color)
                },
            ));
        } else if row == WORDMARK_ROW + 1 {
            spans.push(Span::styled(
                format!("v{}", env!("CARGO_PKG_VERSION")),
                Style::default().fg(muted()),
            ));
        }
        lines.push(Line::from(spans));
    }
    lines
}

/// Rows in the small mark shown above a conversation.
pub const SMALL_MARK_ROWS: usize = 4;

/// The same head at half size: each dot is on when at least two of the four
/// dots it covers in `mark()` are, which keeps the ears and antler readable.
fn small_mark() -> [&'static str; SMALL_MARK_ROWS] {
    if unicode() {
        ["⢴⣦⢸⣷ ⣶⠄ ", "⠈⠻⣿⣿⣼⠷  ", "  ⢿⣿⣿⣦⣄ ", "  ⢾⣿⡟⠛⠁ "]
    } else {
        ["o#.## #.", " o####o ", "  #####o", "  o##o' "]
    }
}

/// Whether to animate. `JACKALOPE_REDUCED_MOTION=1` keeps every indicator
/// still; state is then carried by glyphs and colour alone.
pub fn motion() -> bool {
    crate::prefs::env_flag("JACKALOPE_REDUCED_MOTION") != Some(true)
}

/// The accent lifted toward the foreground by `amount` (0–1): white on dark
/// and unknown grounds, black on light ones.
fn lifted(amount: f32) -> Color {
    if !colored() {
        return Color::Reset;
    }
    if !truecolor() {
        return accent();
    }
    let (r, g, b) = current_accent();
    let toward = if background() == Background::Light {
        0.0
    } else {
        255.0
    };
    let blend = |channel: u8| (channel as f32 + (toward - channel as f32) * amount).round() as u8;
    Color::Rgb(blend(r), blend(g), blend(b))
}

/// How brightly column `column` catches a highlight sweeping left to right
/// across `width` columns at animation frame `tick`. Zero when still.
fn glint(column: usize, width: usize, tick: usize) -> f32 {
    const BAND: f32 = 3.0;
    // The sweep travels past both edges so it enters and leaves smoothly.
    let span = width as f32 + BAND * 4.0;
    let position = (tick as f32 * 0.8) % span - BAND * 2.0;
    let distance = (column as f32 - position).abs();
    (1.0 - distance / BAND).max(0.0)
}

fn glinting(column: usize, width: usize, tick: usize, base: Style) -> Style {
    let weight = glint(column, width, tick);
    if weight <= 0.0 {
        base
    } else if truecolor() {
        base.fg(lifted(weight * 0.7))
    } else {
        base.add_modifier(Modifier::BOLD)
    }
}

/// Text with a highlight sweeping across it while work runs, the way the
/// desktop mascot moves only when an agent is busy.
pub fn shimmer(text: &str, tick: usize, base: Style) -> Vec<Span<'static>> {
    if !motion() || !colored() {
        return vec![Span::styled(text.to_string(), base)];
    }
    let width = text.chars().count();
    text.chars()
        .enumerate()
        .map(|(column, character)| {
            Span::styled(character.to_string(), glinting(column, width, tick, base))
        })
        .collect()
}

/// The conversation header: the small mark beside up to four lines of
/// context. The mark catches a sweeping highlight only while `working`.
pub fn header(info: Vec<Line<'static>>, working: bool, tick: usize) -> Vec<Line<'static>> {
    let mark = small_mark();
    let base = Style::default().fg(accent());
    let mut info = info.into_iter();
    mark.iter()
        .map(|row| {
            let mut spans = vec![Span::raw(" ")];
            if working && motion() {
                let width = row.chars().count();
                spans.extend(row.chars().enumerate().map(|(column, glyph)| {
                    // The mark's sweep runs ahead of the status text's.
                    Span::styled(glyph.to_string(), glinting(column, width, tick / 2, base))
                }));
            } else {
                spans.push(Span::styled(*row, base));
            }
            spans.push(Span::raw("  "));
            if let Some(line) = info.next() {
                spans.extend(line.spans);
            }
            Line::from(spans)
        })
        .collect()
}

/// A single-line version for short terminals and once a conversation is under
/// way, where eight lines of banner would crowd out the conversation.
pub fn compact() -> Line<'static> {
    let glyph = if unicode() { "⣼⡿" } else { "#" };
    Line::from(vec![
        Span::raw(" "),
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
        assert_eq!(lines.len(), MARK_ROWS);
        let text = |line: &Line| -> String {
            line.spans
                .iter()
                .map(|span| span.content.as_ref())
                .collect()
        };
        // The echoes and the solid wordmark form one run of lines.
        let wordmarks: Vec<usize> = (0..lines.len())
            .filter(|&row| text(&lines[row]).contains("jackalope"))
            .collect();
        assert_eq!(
            wordmarks,
            (WORDMARK_ROW - ECHOES..=WORDMARK_ROW).collect::<Vec<_>>()
        );
        assert!(lines[WORDMARK_ROW]
            .spans
            .last()
            .unwrap()
            .style
            .add_modifier
            .contains(Modifier::BOLD));
    }

    #[test]
    fn every_mark_row_has_the_same_width() {
        for row in mark() {
            assert_eq!(row.chars().count(), 16, "{row:?}");
        }
    }

    #[test]
    fn project_accents_use_matching_indexed_colours_and_reject_invalid_hex() {
        assert_eq!(indexed((0, 175, 135)), Color::Indexed(36));
        assert_eq!(indexed((175, 95, 215)), Color::Indexed(134));
        assert_eq!(indexed((128, 128, 128)), Color::Indexed(244));
        assert_eq!(parse_hex("#0a8"), Some((0, 170, 136)));
        for invalid in ["#éabc", "#ééé", "#gg0000", "#12345", "00aa88"] {
            assert_eq!(parse_hex(invalid), None);
        }
    }

    #[test]
    fn project_colours_keep_their_hue_and_reach_readable_contrast() {
        let dark = DARK_GROUND;
        let light = LIGHT_GROUND;
        for hex in [
            "#ffe066", "#1a1a6e", "#6d28d9", "#16a34a", "#f97316", "#ffffff", "#000000",
        ] {
            let original = parse_hex(hex).unwrap();
            let unknown = luminance(readable(original, Background::Unknown));
            assert!(
                contrast(unknown, dark) >= 2.99 && contrast(unknown, light) >= 2.99,
                "{hex}"
            );
            let on_dark = luminance(readable(original, Background::Dark));
            assert!(contrast(on_dark, dark) >= 4.49, "{hex} on dark");
            let on_light = luminance(readable(original, Background::Light));
            assert!(contrast(on_light, light) >= 4.49, "{hex} on light");
        }
        // A colour that already reads is left exactly as chosen, and an
        // adjusted one keeps its hue.
        let green = parse_hex("#16a34a").unwrap();
        assert_eq!(readable(green, Background::Unknown), green);
        let pale = parse_hex("#ffe066").unwrap();
        let adjusted = readable(pale, Background::Unknown);
        assert!((to_hsl(adjusted).0 - to_hsl(pale).0).abs() < 3.0);
    }

    #[test]
    fn small_mark_rows_share_a_width_and_the_glint_passes_every_column() {
        for row in small_mark() {
            assert_eq!(row.chars().count(), 8, "{row:?}");
        }
        for column in 0..8 {
            assert!(
                (0..200).any(|tick| glint(column, 8, tick) > 0.5),
                "column {column} never lights"
            );
        }
        assert!(
            (0..200).any(|tick| glint(4, 8, tick) == 0.0),
            "the glint rests"
        );
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
