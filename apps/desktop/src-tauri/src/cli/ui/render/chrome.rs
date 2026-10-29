//! The shell around the content card: a header line with where you are and
//! who is working, and a status line with the work's state and key hints.
//! Both sit directly on the shell, like the desktop app's title and status
//! areas, and what they show can be clicked.

use super::super::{App, Click};
use crate::brand;
use crate::protocol;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::Span;
use ratatui::Frame;

/// One piece of a line, and what clicking it does.
type Piece = (Span<'static>, Option<Click>);

/// Writes `pieces` left to right from `x` on row `y`, up to `limit`,
/// recording where each clickable piece landed. Returns the next column.
/// Pieces that do what the one under the pointer does highlight together, so
/// a tab made of several pieces lights up as one.
fn place(frame: &mut Frame, app: &App, x: u16, y: u16, limit: u16, pieces: Vec<Piece>) -> u16 {
    let hovered = app.hover.filter(|(_, row)| *row == y).and_then(|(at, _)| {
        let mut column = x;
        pieces.iter().find_map(|(span, click)| {
            let width = span.width() as u16;
            let found = (column..column + width).contains(&at).then_some(*click);
            column += width;
            found
        })
    });
    let mut column = x;
    for (mut span, click) in pieces {
        let width = span.width() as u16;
        if column + width > limit {
            break;
        }
        if click.is_some() && hovered == Some(click) {
            span.style = span.style.patch(brand::selection());
        }
        frame.buffer_mut().set_span(column, y, &span, width);
        if let Some(click) = click {
            app.hits
                .borrow_mut()
                .push((Rect::new(column, y, width, 1), click));
        }
        column += width;
    }
    column
}

fn width(pieces: &[Piece]) -> u16 {
    pieces.iter().map(|(span, _)| span.width() as u16).sum()
}

fn text(content: String, color: Color) -> Span<'static> {
    Span::styled(content, Style::default().fg(color))
}

fn separator() -> Piece {
    (text("   ".into(), brand::muted()), None)
}

/// The header: the wordmark and conversation on the left; the agent, project,
/// branch and other conversations on the right.
pub fn header(frame: &mut Frame, app: &App, area: Rect) {
    let mut left: Vec<Piece> = vec![(
        Span::styled(
            format!("{} jackalope", if brand::unicode() { "◆" } else { "*" }),
            Style::default()
                .fg(brand::accent())
                .add_modifier(Modifier::BOLD),
        ),
        Some(Click::Command("new")),
    )];
    let title = match &app.view {
        Some(view) => Some(view.title.clone()),
        None => None,
    };

    let tabbed = tabs_shown(app);
    let mut right: Vec<Piece> = Vec::new();
    let others: Vec<_> = app
        .sessions
        .iter()
        .filter(|session| Some(&session.id) != app.session.as_ref())
        .collect();
    let waiting = others
        .iter()
        .filter(|session| protocol::present(session.error.as_deref()).is_some())
        .count();
    if tabbed {
    } else if waiting > 0 {
        right.push((
            brand::chip(&format!("{waiting} need you"), brand::warning()),
            Some(Click::Command("sessions")),
        ));
        right.push(separator());
    } else if !others.is_empty() {
        right.push((
            text(format!("{} open", others.len()), brand::muted()),
            Some(Click::Command("sessions")),
        ));
        right.push(separator());
    }
    let agent = app
        .view
        .as_ref()
        .and_then(|view| view.agent.clone())
        .or_else(|| app.next_agent.as_ref().map(|agent| app.agent_name(agent)));
    if let Some(agent) = agent {
        right.push((text(agent, brand::text()), Some(Click::Command("agent"))));
        if let Some(model) = app.view.as_ref().and_then(|view| view.model.clone()) {
            right.push((
                text(format!(" {model}"), brand::muted()),
                Some(Click::Command("model")),
            ));
        }
        right.push(separator());
    }
    right.push((
        text(app.project.name.clone(), brand::muted()),
        Some(Click::Command("projects")),
    ));
    let branch = app
        .view
        .as_ref()
        .and_then(|view| view.branch.clone())
        .filter(|branch| !branch.is_empty())
        .or_else(|| app.branch.clone());
    if let Some(branch) = branch {
        right.push((
            text(
                format!(
                    "  {} {}",
                    if brand::unicode() { "⎇" } else { "@" },
                    brand::short_branch(&branch)
                ),
                brand::accent(),
            ),
            None,
        ));
    }

    let right_start = area.right().saturating_sub(width(&right) + 2);
    let left_end = place(
        frame,
        app,
        area.x + 2,
        area.y,
        right_start,
        std::mem::take(&mut left),
    );
    if tabbed {
        tabs(
            frame,
            app,
            left_end + 3,
            area.y,
            right_start.saturating_sub(3),
        );
    } else if let Some(title) = title {
        let room = right_start.saturating_sub(left_end + 6) as usize;
        place(
            frame,
            app,
            left_end,
            area.y,
            right_start,
            vec![(
                text(
                    format!("   {}", brand::ellipsize(&title, room)),
                    brand::text(),
                ),
                None,
            )],
        );
    }
    if right_start > left_end {
        place(frame, app, right_start, area.y, area.right(), right);
    }
}

/// Tabs appear once there is more than one conversation to move between.
fn tabs_shown(app: &App) -> bool {
    let order = app.tab_order();
    match order.len() {
        0 => false,
        1 => app.session.as_ref() != Some(&order[0]),
        _ => true,
    }
}

/// How a tab's conversation is doing: its dot and colour.
fn tab_state(app: &App, session: &protocol::SessionSummary) -> (&'static str, Color) {
    let current = app.session.as_ref() == Some(&session.id);
    let needs_you = super::super::conversation::needs_you(session)
        || (current
            && (app
                .view
                .as_ref()
                .is_some_and(|view| !view.questions.is_empty())
                || app.pending_deviation().is_some()));
    let working = if current {
        app.working()
    } else {
        protocol::working(session.status.as_deref())
    };
    let dot = if brand::unicode() { "●" } else { "*" };
    if needs_you {
        (dot, brand::warning())
    } else if working {
        (brand::spinner(app.tick), brand::accent())
    } else if session.paused {
        (if brand::unicode() { "◌" } else { "-" }, brand::muted())
    } else {
        (if brand::unicode() { "○" } else { "o" }, brand::muted())
    }
}

/// The open conversations as tabs between `x` and `limit`: a number for
/// Alt+number, a dot for how each is doing, and its title. Titles shorten to
/// fit; what still does not fit is counted at the end.
fn tabs(frame: &mut Frame, app: &App, x: u16, y: u16, limit: u16) {
    let order = app.tab_order();
    let room = limit.saturating_sub(x) as usize;
    let label = |index: usize, title_width: usize| {
        let session = app
            .sessions
            .iter()
            .find(|session| session.id == order[index]);
        let title = session.map(|session| session.title.as_str()).unwrap_or("");
        let number = if index < 9 {
            format!("{} ", index + 1)
        } else {
            String::new()
        };
        format!(" {number}  {} ", brand::ellipsize(title, title_width))
    };
    let titles: Vec<usize> = order
        .iter()
        .map(|id| {
            app.sessions
                .iter()
                .find(|session| &session.id == id)
                .map_or(0, |session| session.title.chars().count())
        })
        .collect();
    let (title_width, shown) = fit_tabs(&titles, room, app.session.is_none());

    let mut pieces: Vec<Piece> = Vec::new();
    for index in 0..shown {
        let Some(session) = app
            .sessions
            .iter()
            .find(|session| session.id == order[index])
        else {
            continue;
        };
        let active = app.session.as_ref() == Some(&session.id);
        let (dot, color) = tab_state(app, session);
        let text = label(index, title_width);
        // The dot sits between the number and the title.
        let (number, title) = text.split_at(text.find("  ").unwrap_or(0) + 1);
        let base = if active {
            Style::default()
                .bg(brand::surface(brand::Surface::Elevated))
                .fg(brand::text())
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(brand::muted())
        };
        let click = Some(Click::Tab(index));
        pieces.push((Span::styled(number.to_string(), base), click));
        pieces.push((Span::styled(dot.to_string(), base.fg(color)), click));
        pieces.push((Span::styled(title.to_string(), base), click));
        pieces.push((Span::raw(" "), None));
    }
    if shown < order.len() {
        pieces.push((
            text(format!("+{} ", order.len() - shown), brand::muted()),
            Some(Click::Command("sessions")),
        ));
    }
    if app.session.is_none() {
        pieces.push((
            Span::styled(
                " + new ",
                Style::default()
                    .bg(brand::surface(brand::Surface::Elevated))
                    .fg(brand::text())
                    .add_modifier(Modifier::BOLD),
            ),
            None,
        ));
    }
    place(frame, app, x, y, limit, pieces);
}

/// How wide tab titles may be and how many tabs fit in `room` columns, given
/// each title's length: titles narrow to eight columns before tabs drop from
/// the end, leaving room for a `+N` count and, while composing, `+ new`.
fn fit_tabs(titles: &[usize], room: usize, composing: bool) -> (usize, usize) {
    // A tab is " N  title " plus a gap: seven columns around the title.
    let total = |shown: usize, width: usize| -> usize {
        titles[..shown]
            .iter()
            .enumerate()
            .map(|(index, title)| title.min(&width) + if index < 9 { 7 } else { 5 })
            .sum::<usize>()
            + if shown < titles.len() { 6 } else { 0 }
            + if composing { 8 } else { 0 }
    };
    let mut width = 24;
    let mut shown = titles.len();
    while total(shown, width) > room && width > 8 {
        width -= 2;
    }
    while total(shown, width) > room && shown > 0 {
        shown -= 1;
    }
    (width, shown)
}

/// The status line: a dot in the state's colour, the state and its details
/// on the left, key hints on the right.
pub fn status(frame: &mut Frame, app: &App, area: Rect) {
    let (label, color, details) = super::status_parts(app);
    let glyph = if app.working() {
        brand::spinner(app.tick)
    } else if brand::unicode() {
        "●"
    } else {
        "*"
    };
    let state = Style::default().fg(color);
    let mut left: Vec<Piece> = vec![(Span::styled(format!("{glyph} "), state), None)];
    if app.working() {
        left.extend(
            brand::shimmer(&label, app.tick, state)
                .into_iter()
                .map(|span| (span, None)),
        );
    } else {
        left.push((Span::styled(label, state), None));
    }
    left.extend(details.into_iter().map(|span| (span, None)));

    let mut hints: Vec<(&str, &str, Click)> = Vec::new();
    if app.working() {
        hints.push(("esc esc", "stop", Click::Command("stop")));
    }
    if !app.changes.is_empty() {
        hints.push(("^O", "files", Click::Command("files")));
    }
    hints.push(("/", "commands", Click::Type("/")));
    if !app.working() {
        hints.push(("!", "shell", Click::Type("!")));
        hints.push(("@", "mention", Click::Type("@")));
    }
    let mut right: Vec<Piece> = Vec::new();
    for (index, (key, label, click)) in hints.into_iter().enumerate() {
        if index > 0 {
            right.push((Span::raw("   "), None));
        }
        right.push((text(key.into(), brand::text()), Some(click)));
        right.push((text(format!(" {label}"), brand::muted()), Some(click)));
    }
    let right_start = area.right().saturating_sub(width(&right) + 2);
    let left_end = place(frame, app, area.x + 2, area.y, area.right(), left);
    if right_start > left_end + 2 {
        place(frame, app, right_start, area.y, area.right(), right);
    }
}

/// Paints the working band along the card's top edge.
pub fn band(frame: &mut Frame, app: &App, card: Rect) {
    if !app.working() {
        return;
    }
    let buffer = frame.buffer_mut();
    for column in card.left() + 1..card.right().saturating_sub(1) {
        let offset = usize::from(column - card.left());
        if let Some(color) = brand::frame_band(offset, card.width as usize, app.tick) {
            if let Some(cell) = buffer.cell_mut((column, card.y)) {
                cell.set_fg(color);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fit_tabs;

    #[test]
    fn tabs_narrow_their_titles_before_any_tab_is_dropped() {
        // Plenty of room: full titles, every tab.
        assert_eq!(fit_tabs(&[10, 12, 30], 200, false), (24, 3));
        // Tighter: titles narrow but all three stay.
        let (width, shown) = fit_tabs(&[30, 30, 30], 60, false);
        assert_eq!(shown, 3);
        assert!(width < 24 && width >= 8);
        // Too tight even at the narrowest: tabs drop from the end.
        let (width, shown) = fit_tabs(&[30; 8], 60, true);
        assert_eq!(width, 8);
        assert!(shown < 8);
        assert_eq!(fit_tabs(&[30; 3], 4, false).1, 0);
    }
}
