//! Jackalope's mark and palette, rendered for a terminal.
//!
//! The desktop mark repeats its silhouette ten times at decreasing opacity —
//! the "echo" in `EchoMark`. A terminal cannot do opacity, but it can do the
//! same idea with a colour ramp, so the wordmark echoes upward into the
//! background instead of fading out.

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use std::sync::OnceLock;

/// The values the terminal shares with the app, kept in `packages/brand` and
/// checked against `themeTokens` by `packages/brand/test/terminal.test.mjs`.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Tokens {
    /// `DEFAULT_THEME`'s accent, Jackalope Violet.
    default_accent: String,
    /// Glyphs text resolves out of, the same noise the ASCII mark decodes
    /// from in the app and on the website.
    noise: String,
    dark: Scheme,
    light: Scheme,
}

/// Neutral tones are `[saturation, lightness]` in the accent's hue; status
/// colours are `[hue, saturation, lightness]`; all in CSS percent and degrees.
#[derive(serde::Deserialize)]
struct Scheme {
    /// `--color-navigation`, around the content card.
    shell: [f64; 2],
    /// `--color-surface`.
    ground: [f64; 2],
    /// `--color-surface-elevated`.
    elevated: [f64; 2],
    /// `--color-border-subtle`.
    hairline: [f64; 2],
    /// `--color-text-primary`.
    text: [f64; 2],
    /// `--color-text-muted`.
    muted: [f64; 2],
    success: [f64; 3],
    warning: [f64; 3],
    danger: [f64; 3],
}

fn tokens() -> &'static Tokens {
    static TOKENS: OnceLock<Tokens> = OnceLock::new();
    TOKENS.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../../../packages/brand/src/terminal.json"
        ))
        .expect("packages/brand/src/terminal.json is valid")
    })
}

fn scheme(dark: bool) -> &'static Scheme {
    if dark {
        &tokens().dark
    } else {
        &tokens().light
    }
}

/// The brand accent, drawn until the project's own colour is known and for
/// projects the app has not themed.
fn default_accent() -> (u8, u8, u8) {
    parse_hex(&tokens().default_accent).expect("the default accent is #rrggbb")
}

/// The accent in use: the project's colour, adjusted to read on this terminal.
static ACCENT: std::sync::RwLock<Option<(u8, u8, u8)>> = std::sync::RwLock::new(None);

fn current_accent() -> (u8, u8, u8) {
    ACCENT
        .read()
        .ok()
        .and_then(|accent| *accent)
        .unwrap_or_else(|| readable(default_accent(), background()))
}

/// Wears the project's colour (`#rrggbb`), or the brand default when absent.
pub fn set_accent(hex: Option<&str>) {
    let color = hex.and_then(parse_hex).unwrap_or_else(default_accent);
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

/// The ground colours are drawn on: the painted surface when the interface
/// paints its own, otherwise whatever the terminal reports.
fn background() -> Background {
    match painted() {
        Some(true) => Background::Dark,
        Some(false) => Background::Light,
        None => terminal_background(),
    }
}

/// Whether the interface paints its own surfaces, and if so whether dark.
///
/// With true colour it wears the app's surface tones (see `themeTokens` in
/// `packages/brand/src/tokens.ts`) so it reads as Jackalope rather than as the
/// terminal's theme. `JACKALOPE_THEME` takes `dark`, `light` or `terminal`
/// (keep the terminal's own background); otherwise a light terminal gets the
/// light surfaces and everything else the dark ones.
fn painted() -> Option<bool> {
    if !colored() || !truecolor() {
        return None;
    }
    match std::env::var("JACKALOPE_THEME")
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "terminal" => None,
        "light" => Some(false),
        "dark" => Some(true),
        _ => Some(terminal_background() != Background::Light),
    }
}

/// The terminal's background, when it says. Many terminals export
/// `COLORFGBG` as `foreground;background` in ANSI indexes; 0–6 and 8 are dark.
fn terminal_background() -> Background {
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

/// Whether 24-bit colour reaches the screen.
///
/// Windows consoles have drawn 24-bit colour since Windows 10, and several
/// terminals that do (Windows Terminal among them) never set `COLORTERM`.
pub fn truecolor() -> bool {
    std::env::var("COLORTERM").is_ok_and(|value| value == "truecolor" || value == "24bit")
        || cfg!(windows)
        || std::env::var_os("WT_SESSION").is_some()
        || std::env::var_os("WEZTERM_PANE").is_some()
        || std::env::var_os("KITTY_WINDOW_ID").is_some()
        || std::env::var("TERM_PROGRAM").is_ok_and(|program| {
            ["iTerm.app", "WezTerm", "vscode", "ghostty", "jackalope"].contains(&program.as_str())
        })
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
    // Windows rarely sets a locale variable, but its consoles and these hosts
    // render Unicode.
    let modern_host = cfg!(windows)
        || std::env::var_os("WT_SESSION").is_some()
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

/// The glyphs used through the interface, each with the plain character drawn
/// where Unicode is unavailable (see `unicode`).
#[derive(Clone, Copy)]
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
    /// A state or agent dot.
    Dot,
    /// An open question on a card or board row.
    Question,
    /// An open question in the conversation.
    Ask,
    /// Before the project's name.
    Project,
    Paused,
    Done,
    Failed,
    Stopped,
    Idle,
    /// A paused conversation's tab.
    Waiting,
    Branch,
    Close,
    /// The end of a reply still being written.
    Caret,
    /// A card's side edge.
    Side,
    /// A callout's left bar.
    Bar,
    TopOpen,
    TopClose,
    BottomOpen,
    BottomClose,
    /// A card edge's horizontal stroke.
    Edge,
    /// The divider between a reply and the record of its work.
    Dashed,
    /// The dotted rule.
    Rule,
    /// The stage gauge.
    Gauge,
    /// A file bar's cell.
    Cell,
    Minus,
    Renamed,
    Ellipsis,
    Prompt,
    /// The mark in one line.
    Compact,
    Read,
    Edit,
    Search,
    Command,
    Check,
    /// Any other step of the work.
    Step,
    /// A chosen option of a question that takes several.
    Ticked,
    Unticked,
}

pub fn mark_glyph(mark: Mark) -> &'static str {
    let (unicode_glyph, plain) = match mark {
        Mark::Full => ("⣿", "#"),
        Mark::Partial => ("⣤", "+"),
        Mark::Attention => ("⠿", "!"),
        Mark::Empty => ("⠄", "."),
        Mark::Cursor => ("⣿", ">"),
        Mark::Dot => ("●", "*"),
        Mark::Question => ("◆", "!"),
        Mark::Ask => ("◆", "?"),
        Mark::Project => ("◆", "*"),
        Mark::Paused => ("‖", "="),
        Mark::Done => ("✓", "+"),
        Mark::Failed => ("✗", "x"),
        Mark::Stopped | Mark::Cell => ("■", "#"),
        Mark::Idle => ("○", "o"),
        Mark::Waiting => ("◌", "-"),
        Mark::Branch => ("⎇", "@"),
        Mark::Close => ("×", "x"),
        Mark::Caret => ("▍", "_"),
        Mark::Side => ("│", "|"),
        Mark::Bar => ("▎", "|"),
        Mark::TopOpen => ("╭─ ", "+- "),
        Mark::TopClose => (" ─╮", " -+"),
        Mark::BottomOpen => ("╰─", "+-"),
        Mark::BottomClose => ("─╯", "-+"),
        Mark::Edge => ("─", "-"),
        Mark::Dashed => ("╌", "-"),
        Mark::Rule => ("⠒", "-"),
        Mark::Gauge => ("━", "="),
        Mark::Minus => ("−", "-"),
        Mark::Renamed => ("→", ">"),
        Mark::Ellipsis => ("…", "."),
        Mark::Prompt => ("❯", ">"),
        Mark::Compact => ("⣼⡿", "#"),
        Mark::Read => ("◇", "r"),
        Mark::Edit => ("✎", "e"),
        Mark::Search => ("⌕", "?"),
        Mark::Command => ("▸", ">"),
        Mark::Check => ("◈", "c"),
        Mark::Step => ("·", "-"),
        Mark::Ticked => ("☑", "[x]"),
        Mark::Unticked => ("☐", "[ ]"),
    };
    if unicode() {
        unicode_glyph
    } else {
        plain
    }
}

/// How strongly column `column` of `width` catches a soft band travelling
/// along it, `half` columns either side of its centre; `None` outside it.
/// One pass every few seconds regardless of width, so wide terminals are not
/// slower, eased so the band has no hard edges.
fn band(column: usize, width: usize, tick: usize, half: usize) -> Option<f32> {
    let span = width + 2 * half;
    let center = (tick * span / 48) % span;
    let distance = (center as isize - half as isize - column as isize).unsigned_abs();
    (distance < half).then(|| 1.0 - (distance as f32 / half as f32).powi(2))
}

/// The dotted rule while an agent works: a soft band of accent glides along
/// the same dots, so only colour moves and the rule keeps its shape. Still
/// (the plain rule) under reduced motion or without colour.
pub fn divider_active(width: u16, tick: usize) -> Line<'static> {
    if !motion() || !colored() {
        return divider(width);
    }
    let dot = mark_glyph(Mark::Rule);
    let width = width as usize;
    let spans = (0..width)
        .map(|column| {
            let color = match band(column, width, tick, 10) {
                None => muted(),
                Some(weight) if truecolor() => mix(muted(), accent(), weight),
                Some(_) => accent(),
            };
            Span::styled(dot, Style::default().fg(color))
        })
        .collect::<Vec<_>>();
    Line::from(spans)
}

/// `from` moved `amount` of the way toward `to`, when both are true colour.
fn mix(from: Color, to: Color, amount: f32) -> Color {
    match (from, to) {
        (Color::Rgb(r1, g1, b1), Color::Rgb(r2, g2, b2)) => {
            rgb(blend((r1, g1, b1), (r2, g2, b2), amount))
        }
        _ => to,
    }
}

/// A dotted rule across `width` columns.
pub fn divider(width: u16) -> Line<'static> {
    Line::styled(
        mark_glyph(Mark::Rule).repeat(width as usize),
        Style::default().fg(muted()),
    )
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

/// Secondary text: a neutral grey held to the same contrast target as the
/// accent, since ANSI dark grey falls near 3:1 on many dark themes.
pub fn muted() -> Color {
    if !colored() {
        return Color::Reset;
    }
    if let Some(dark) = painted() {
        return rgb(tinted(scheme(dark).muted));
    }
    tone((0x8b, 0x90, 0x99), Color::DarkGray)
}

/// The app's surface layers, which the terminal paints when it can.
#[derive(Clone, Copy)]
pub enum Surface {
    /// Around the content card, a step darker (`--color-navigation`).
    Shell,
    /// The content card (`--color-surface`).
    Ground,
    /// Popups and the input (`--color-surface-elevated`).
    Elevated,
}

/// A neutral tone tinted with the accent's hue, as `themeTokens` tints them.
fn tinted([saturation, lightness]: [f64; 2]) -> (u8, u8, u8) {
    let (hue, _, _) = to_hsl(current_accent());
    from_hsl(hue, saturation / 100.0, lightness / 100.0)
}

fn rgb((r, g, b): (u8, u8, u8)) -> Color {
    Color::Rgb(r, g, b)
}

fn surface_rgb(level: Surface) -> Option<(u8, u8, u8)> {
    let scheme = scheme(painted()?);
    Some(tinted(match level {
        Surface::Shell => scheme.shell,
        Surface::Ground => scheme.ground,
        Surface::Elevated => scheme.elevated,
    }))
}

/// A surface tone, or Reset where the terminal's own background shows.
pub fn surface(level: Surface) -> Color {
    surface_rgb(level).map_or(Color::Reset, rgb)
}

/// Hairline borders (`--color-border-subtle`), or the muted grey unpainted.
pub fn hairline() -> Color {
    match painted() {
        Some(dark) => rgb(tinted(scheme(dark).hairline)),
        None => muted(),
    }
}

/// Body text (`--color-text-primary`), or the terminal's own foreground.
pub fn text() -> Color {
    match painted() {
        Some(dark) => rgb(tinted(scheme(dark).text)),
        None => Color::Reset,
    }
}

/// The base style of a painted area at `level`.
pub fn painted_style(level: Surface) -> Style {
    Style::default().bg(surface(level)).fg(text())
}

/// Behind the highlighted row of a menu or picker: the accent faded most of the
/// way into the popup's ground. Terminals without true colour reverse the row
/// instead.
pub fn selection() -> Style {
    if !colored() || !truecolor() {
        return Style::default().add_modifier(Modifier::REVERSED);
    }
    let accent = current_accent();
    let light = background() == Background::Light;
    let ground = surface_rgb(Surface::Elevated).unwrap_or(if light {
        (255, 255, 255)
    } else {
        (30, 30, 30)
    });
    Style::default().bg(rgb(blend(ground, accent, if light { 0.16 } else { 0.28 })))
}

/// `from` moved `amount` (0–1) of the way toward `to`.
fn blend(from: (u8, u8, u8), to: (u8, u8, u8), amount: f32) -> (u8, u8, u8) {
    let step = |a: u8, b: u8| (a as f32 + (b as f32 - a as f32) * amount).round() as u8;
    (step(from.0, to.0), step(from.1, to.1), step(from.2, to.2))
}

/// Rounded corners where box-drawing arcs are available.
pub fn border() -> ratatui::widgets::BorderType {
    if unicode() {
        ratatui::widgets::BorderType::Rounded
    } else {
        ratatui::widgets::BorderType::Plain
    }
}

/// `text` cut to `width` columns, ending in an ellipsis when shortened.
pub fn ellipsize(text: &str, width: usize) -> String {
    if text.chars().count() <= width {
        return text.to_string();
    }
    let ellipsis = mark_glyph(Mark::Ellipsis);
    let kept: String = text.chars().take(width.saturating_sub(1)).collect();
    format!("{}{ellipsis}", kept.trim_end())
}

/// A branch name with long generated ids (task worktrees use UUIDs) cut to
/// their first eight characters, so the readable part stays visible.
pub fn short_branch(branch: &str) -> String {
    branch
        .split('/')
        .map(|part| {
            let generated = part.len() > 16
                && part.chars().all(|ch| ch.is_ascii_hexdigit() || ch == '-')
                && part.contains('-');
            if generated {
                part.chars().take(8).collect()
            } else {
                part.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// A status colour for the ground in use (the dark tone on unknown grounds),
/// adjusted to read there.
fn status(pick: fn(&Scheme) -> [f64; 3], basic: Color) -> Color {
    if !colored() {
        return Color::Reset;
    }
    let [hue, saturation, lightness] = pick(scheme(background() != Background::Light));
    tone(from_hsl(hue, saturation / 100.0, lightness / 100.0), basic)
}

/// Completed work and confirmed input.
pub fn success() -> Color {
    status(|scheme| scheme.success, Color::Green)
}

/// Mentions of agents and files, kept apart from plan mode's green.
pub fn info() -> Color {
    if !colored() {
        return Color::Reset;
    }
    tone((0x3b, 0x82, 0xf6), Color::Blue)
}

/// Slash commands in the input: the brand violet, or teal when the project's
/// accent is already near it, so a command never looks like a plain message.
pub fn command() -> Color {
    if !colored() {
        return Color::Reset;
    }
    let (hue, _, _) = to_hsl(current_accent());
    let violet = default_accent();
    if (hue - to_hsl(violet).0).abs() < 35.0 {
        tone((0x14, 0xb8, 0xa6), Color::Cyan)
    } else {
        tone(violet, Color::Magenta)
    }
}

/// Work that needs attention: an open question, a sign-in, a stalled action.
pub fn warning() -> Color {
    status(|scheme| scheme.warning, Color::Yellow)
}

/// Failures and errors.
pub fn danger() -> Color {
    status(|scheme| scheme.danger, Color::Red)
}

/// The accent's neighbour: the same colour turned 40° round the wheel, so a
/// gradient between them stays in one family the way the app's palette does.
fn secondary() -> (u8, u8, u8) {
    let (hue, saturation, lightness) = to_hsl(current_accent());
    readable(
        from_hsl((hue + 40.0).rem_euclid(360.0), saturation, lightness),
        background(),
    )
}

/// The accent gradient at `position` (0 at the start, 1 at the end), or the
/// plain accent where true colour is unavailable.
pub fn gradient(position: f32) -> Color {
    if !colored() || !truecolor() {
        return accent();
    }
    rgb(blend(
        current_accent(),
        secondary(),
        position.clamp(0.0, 1.0),
    ))
}

/// The frame's colour at `position` along it: the gradient softened into the
/// ground so it holds things together without competing with them.
pub fn frame_at(position: f32) -> Color {
    match (surface_rgb(Surface::Ground), gradient(position)) {
        (Some(ground), Color::Rgb(r, g, b)) => rgb(blend(ground, (r, g, b), 0.6)),
        (_, color) => color,
    }
}

/// `text` as a chip: padded, on a tint of `color`. Without true colour the
/// tint is dropped and the text keeps `color`.
pub fn chip(text: &str, color: Color) -> Span<'static> {
    let label = format!(" {text} ");
    match (surface_rgb(Surface::Ground), color) {
        (Some(ground), Color::Rgb(r, g, b)) => Span::styled(
            label,
            Style::default()
                .bg(rgb(blend(ground, (r, g, b), 0.2)))
                .fg(text_on_tint()),
        ),
        _ => Span::styled(label, Style::default().fg(color)),
    }
}

fn text_on_tint() -> Color {
    match text() {
        Color::Reset => accent(),
        color => color,
    }
}

/// A block of `color`: its tint behind the text and a bar of it down the left
/// edge, for your messages, questions and errors.
pub fn callout_style(color: Color) -> Style {
    match (surface_rgb(Surface::Ground), color) {
        (Some(ground), Color::Rgb(r, g, b)) => {
            Style::default().bg(rgb(blend(ground, (r, g, b), 0.07)))
        }
        _ => Style::default(),
    }
}

/// Six-pixel capitals for the wordmark, two pixels to a cell row.
const LETTERS: [(char, &[&str]); 8] = [
    (
        'J',
        &["  ####", "    ##", "    ##", "    ##", "##  ##", " #### "],
    ),
    (
        'A',
        &[" #### ", "##  ##", "##  ##", "######", "##  ##", "##  ##"],
    ),
    (
        'C',
        &[" #####", "##    ", "##    ", "##    ", "##    ", " #####"],
    ),
    (
        'K',
        &["##  ##", "## ## ", "####  ", "####  ", "## ## ", "##  ##"],
    ),
    (
        'L',
        &["##    ", "##    ", "##    ", "##    ", "##    ", "######"],
    ),
    (
        'O',
        &[" #### ", "##  ##", "##  ##", "##  ##", "##  ##", " #### "],
    ),
    (
        'P',
        &["##### ", "##  ##", "##  ##", "##### ", "##    ", "##    "],
    ),
    (
        'E',
        &["######", "##    ", "##### ", "##    ", "##    ", "######"],
    ),
];

/// Four-pixel capitals with single strokes, for narrow windows.
const SMALL_LETTERS: [(char, &[&str]); 8] = [
    ('J', &[" ###", "   #", "#  #", " ## "]),
    ('A', &[" ## ", "#  #", "####", "#  #"]),
    ('C', &[" ###", "#   ", "#   ", " ###"]),
    ('K', &["#  #", "# # ", "### ", "#  #"]),
    ('L', &["#   ", "#   ", "#   ", "####"]),
    ('O', &[" ## ", "#  #", "#  #", " ## "]),
    ('P', &["### ", "#  #", "### ", "#   "]),
    ('E', &["####", "#   ", "### ", "####"]),
];

/// Columns the wordmark needs.
pub const WORDMARK_WIDTH: usize = 9 * 7 - 1;

/// Columns the narrow wordmark needs.
pub const SMALL_WORDMARK_WIDTH: usize = 9 * 5 - 1;

/// "JACKALOPE" in block capitals, three rows tall or two when `small` (for
/// windows narrower than `WORDMARK_WIDTH`), swept by the accent gradient. Half
/// blocks give each row two pixels, so the letters keep round shoulders
/// without box-drawing. Light crosses it once while `sweep` (0 to 1) runs on
/// the start screen. While `glitch` (0 to 1, and the animation frame) runs,
/// its letters break into noise and resolve back left to right the way the
/// ASCII mark decodes; only the letters' own cells change, so the word keeps
/// its shape. Both stay still without motion.
pub fn wordmark(
    small: bool,
    sweep: Option<f32>,
    glitch: Option<(f32, usize)>,
) -> Vec<Line<'static>> {
    let sweep = sweep.filter(|_| motion() && colored());
    let glitch = glitch.filter(|_| motion());
    block_letters(if small { &SMALL_LETTERS } else { &LETTERS }, sweep, glitch)
}

/// What a lettered cell shows partway through a glitch: its own block, the
/// block lit as it settles, or noise.
enum Glitched {
    Settled,
    Settling,
    Noise(&'static str),
}

/// The share of a glitch spent breaking up; the rest resolves.
const BREAK: f32 = 0.25;

fn glitched(cell: usize, position: f32, progress: f32, tick: usize) -> Glitched {
    let chance = (scatter(cell, 7) % 1000) as f32 / 1000.0;
    let noisy = if progress < BREAK {
        chance < progress / BREAK
    } else {
        // Stretched a little so the last cells settle before the glitch ends.
        let resolving = 1.1 * (progress - BREAK) / (1.0 - BREAK);
        let order = 0.65 * position + 0.35 * chance;
        if resolving >= order + 0.06 {
            return Glitched::Settled;
        }
        if resolving >= order {
            return Glitched::Settling;
        }
        true
    };
    if noisy {
        Glitched::Noise(noise(scatter(cell, tick)))
    } else {
        Glitched::Settled
    }
}

/// How brightly a column at `position` (0 to 1) catches a sweep at `sweep`,
/// which enters before the first letter and leaves after the last.
fn sweep_light(position: f32, sweep: f32) -> f32 {
    const BAND: f32 = 0.12;
    let center = -BAND + sweep * (1.0 + 2.0 * BAND);
    (1.0 - ((position - center).abs() / BAND)).max(0.0)
}

fn block_letters(
    letters: &[(char, &[&str]); 8],
    sweep: Option<f32>,
    glitch: Option<(f32, usize)>,
) -> Vec<Line<'static>> {
    let glyphs: Vec<&[&str]> = "JACKALOPE"
        .chars()
        .filter_map(|letter| {
            letters
                .iter()
                .find(|(key, _)| *key == letter)
                .map(|(_, rows)| *rows)
        })
        .collect();
    let height = glyphs[0].len();
    let width = glyphs[0][0].len();
    let total = glyphs.len() * (width + 1) - 1;
    let on = |glyph: &[&str], row: usize, column: usize| {
        glyph
            .get(row)
            .is_some_and(|line| line.as_bytes()[column] == b'#')
    };
    (0..height.div_ceil(2))
        .map(|cell| {
            let mut spans = Vec::new();
            for (index, glyph) in glyphs.iter().enumerate() {
                if index > 0 {
                    spans.push(Span::raw(" "));
                }
                for column in 0..width {
                    let symbol =
                        match (on(glyph, cell * 2, column), on(glyph, cell * 2 + 1, column)) {
                            (true, true) => "█",
                            (true, false) => "▀",
                            (false, true) => "▄",
                            (false, false) => " ",
                        };
                    let offset = index * (width + 1) + column;
                    let position = offset as f32 / total as f32;
                    let light = sweep.map_or(0.0, |sweep| sweep_light(position, sweep));
                    let mut color = if light > 0.0 {
                        mix(gradient(position), lifted(0.85), light)
                    } else {
                        gradient(position)
                    };
                    let mut symbol = symbol;
                    if let Some((progress, tick)) = glitch.filter(|_| symbol != " ") {
                        match glitched(cell * total + offset, position, progress, tick) {
                            Glitched::Settled => {}
                            Glitched::Settling => color = lifted(0.6),
                            Glitched::Noise(glyph) => symbol = glyph,
                        }
                    }
                    spans.push(Span::styled(symbol, Style::default().fg(color)));
                }
            }
            Line::from(spans)
        })
        .collect()
}

/// The colour of column `column` of a `width`-wide frame edge while work
/// runs: a soft band of accent travelling along it. `None` when still.
pub fn frame_band(column: usize, width: usize, tick: usize) -> Option<Color> {
    if !motion() || !colored() {
        return None;
    }
    let weight = band(column, width, tick, 12)?;
    Some(mix(
        frame_at(column as f32 / width.max(1) as f32),
        lifted(0.3),
        weight,
    ))
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
    let toward = if background() == Background::Light {
        (0, 0, 0)
    } else {
        (255, 255, 255)
    };
    rgb(blend(current_accent(), toward, amount))
}

/// How brightly column `column` catches a highlight sweeping left to right
/// across `width` columns at animation frame `tick`. Zero when still.
fn glint(column: usize, width: usize, tick: usize) -> f32 {
    const BAND: f32 = 3.0;
    // The sweep travels past both edges so it enters and leaves smoothly.
    let span = width as f32 + BAND * 4.0;
    let position = (tick as f32 * 0.55) % span - BAND * 2.0;
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

/// The noise glyph at `index`, wrapping round the set.
fn noise(index: u32) -> &'static str {
    let noise = tokens().noise.as_str();
    let count = noise.chars().count().max(1);
    noise
        .char_indices()
        .nth(index as usize % count)
        .map_or("?", |(at, glyph)| &noise[at..at + glyph.len_utf8()])
}

/// A cheap, stable scramble of two numbers, so noise and settle order are
/// the same on every frame and in tests.
fn scatter(a: usize, b: usize) -> u32 {
    let mut x = (a as u32).wrapping_mul(0x9e37_79b1) ^ (b as u32).wrapping_mul(0x85eb_ca77);
    x ^= x >> 15;
    x = x.wrapping_mul(0x2c1b_3c6d);
    x ^= x >> 12;
    x
}

/// `line` resolving out of noise as `progress` runs from 0 to 1, the way the
/// ASCII mark decodes: characters settle roughly left to right, each at its
/// own moment, the ones settling flash in the accent and the rest flicker as
/// noise. Spaces stay put so words keep their shape. The line is unchanged
/// from 1 on, and always under reduced motion.
pub fn decode(line: Line<'static>, progress: f32, tick: usize, seed: usize) -> Line<'static> {
    if progress >= 1.0 || !motion() {
        return line;
    }
    let total = line
        .spans
        .iter()
        .map(|span| span.content.chars().count())
        .sum::<usize>()
        .max(1);
    let scrambled = Style::default().fg(muted());
    let hot = Style::default().fg(lifted(0.35));
    let mut spans: Vec<Span<'static>> = Vec::new();
    let mut push = |text: &str, style: Style| match spans.last_mut() {
        Some(last) if last.style == style => last.content.to_mut().push_str(text),
        _ => spans.push(Span::styled(text.to_string(), style)),
    };
    let mut column = 0;
    let mut buffer = [0; 4];
    for span in &line.spans {
        for character in span.content.chars() {
            let order = 0.65 * column as f32 / total as f32
                + 0.35 * (scatter(column, seed) % 1000) as f32 / 1000.0;
            if character == ' ' || progress >= order + 0.08 {
                push(character.encode_utf8(&mut buffer), span.style);
            } else if progress >= order {
                push(character.encode_utf8(&mut buffer), span.style.patch(hot));
            } else {
                push(
                    noise(scatter(column + seed, tick)),
                    span.style.patch(scrambled),
                );
            }
            column += 1;
        }
    }
    Line::from(spans).style(line.style)
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

/// The mark and the project's name in one line, for terminals too small for
/// the framed header, where a banner would crowd out the conversation.
pub fn compact(project: &str) -> Line<'static> {
    let glyph = mark_glyph(Mark::Compact);
    Line::from(vec![
        Span::raw(" "),
        Span::styled(glyph, Style::default().fg(accent())),
        Span::raw(" "),
        Span::styled(
            project.to_string(),
            Style::default().fg(accent()).add_modifier(Modifier::BOLD),
        ),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn the_wordmark_spells_jackalope_at_its_declared_width() {
        let lines = wordmark(false, None, None);
        assert_eq!(lines.len(), 3);
        for line in &lines {
            assert_eq!(line.width(), WORDMARK_WIDTH);
        }
        for (_, rows) in LETTERS {
            assert!(rows.iter().all(|row| row.len() == 6), "{rows:?}");
        }
        let small = wordmark(true, None, None);
        assert_eq!(small.len(), 2);
        for line in &small {
            assert_eq!(line.width(), SMALL_WORDMARK_WIDTH);
        }
    }

    #[test]
    fn the_wordmark_sweep_crosses_every_column_and_ends_dark() {
        for step in 0..=40 {
            let sweep = step as f32 / 40.0;
            assert!((0.0..=1.0).contains(&sweep_light(0.5, sweep)));
        }
        for column in 0..=20 {
            let position = column as f32 / 20.0;
            assert!(
                (0..=100).any(|step| sweep_light(position, step as f32 / 100.0) > 0.5),
                "column {position} never lights"
            );
        }
        assert_eq!(sweep_light(0.0, 1.0), 0.0);
        assert_eq!(sweep_light(1.0, 0.0), 0.0);
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
    fn long_text_and_generated_branches_shorten_readably() {
        assert_eq!(
            short_branch("jackalope/df4d8ac2-3ec5-4d56-9ffb-adce79da1bf0"),
            "jackalope/df4d8ac2"
        );
        assert_eq!(short_branch("feature/login-form"), "feature/login-form");
        assert_eq!(ellipsize("short", 10), "short");
        let cut = ellipsize("start a fresh conversation", 10);
        assert_eq!(cut.chars().count(), 10.min(cut.chars().count()));
        assert!(cut.starts_with("start a f") || cut.starts_with("start a"));
    }

    #[test]
    fn the_shared_brand_values_load_and_the_noise_wraps() {
        assert_eq!(Some(default_accent()), parse_hex(&tokens().default_accent));
        let count = tokens().noise.chars().count();
        assert!(count > 1);
        assert_eq!(noise(0), noise(count as u32));
        assert_eq!(noise(0).chars().count(), 1);
    }

    #[test]
    fn the_working_rule_keeps_its_width_and_moves() {
        let text = |tick| -> String {
            divider_active(40, tick)
                .spans
                .iter()
                .map(|span| span.content.to_string())
                .collect()
        };
        let colors = |tick| -> Vec<_> {
            divider_active(40, tick)
                .spans
                .iter()
                .map(|span| span.style.fg)
                .collect()
        };
        assert_eq!(text(5).chars().count(), 40);
        assert_eq!(text(5), text(15), "only colour moves");
        if motion() && colored() {
            assert_ne!(colors(5), colors(15), "the band advances between frames");
        }
    }

    #[test]
    fn a_glitch_breaks_only_the_letters_and_resolves_back_to_the_wordmark() {
        let plain = wordmark(false, None, None);
        let text = |lines: &[Line]| -> Vec<String> {
            lines
                .iter()
                .map(|line| {
                    line.spans
                        .iter()
                        .map(|span| span.content.as_ref())
                        .collect()
                })
                .collect()
        };
        let middle = wordmark(false, None, Some((0.3, 4)));
        assert_ne!(text(&middle), text(&plain), "mid-glitch shows noise");
        for (glitched, clean) in text(&middle).iter().zip(text(&plain)) {
            for (a, b) in glitched.chars().zip(clean.chars()) {
                assert_eq!(a == ' ', b == ' ', "the word keeps its shape");
            }
        }
        assert_eq!(text(&wordmark(false, None, Some((1.0, 4)))), text(&plain));
    }
}
