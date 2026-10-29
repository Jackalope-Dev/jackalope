//! Drawing a frame: header, transcript, status line, input, tips and popups.

mod chrome;
mod markdown;
mod menus;
mod panel;
mod plan;
pub mod transcript;

use super::commands::slash_matches;
use super::editor::Layout as InputLayout;
use super::pickers::{agent_glyph, usable};
use super::App;
use crate::brand::{self, Surface};
use crate::protocol::{self, SessionSummary};
use markdown::inline;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Padding, Paragraph, Wrap};
use ratatui::Frame;
use std::time::Duration;

pub const TIPS: &[&str] = &[
    "Run `/learn` to extract session history into reusable project context.",
    "Type `/` to search all commands with arrow navigation and tab completion.",
    "`Ctrl+O` shows changed files here; `/review` opens them in the app.",
    "Use `/agent` to choose which AI coding agent handles your next conversation.",
    "Switch between active conversations in this directory with `/sessions`.",
    "Start a fresh conversation anytime with `/new`.",
    "Press `Shift+Enter`, `Alt+Enter` or `Ctrl+J` to insert a newline without submitting.",
    "Use `/stop` to halt running agent execution immediately.",
    "Run `/retry` to re-execute the last message after an interruption or failure.",
    "Open the full Jackalope desktop workspace anytime with `/open`.",
    "Learned lessons from `/learn` are automatically applied to future relevant tasks.",
    "Scroll conversation history with mouse wheel or `Page Up` / `Page Down`.",
    "Use `/status` to inspect the host, connected agents, and current branch.",
    "Manage Git commit attribution and host settings with `/settings`.",
    "Clear notes and finished command output anytime with `Ctrl+L`.",
    "Start a line with `!` to run a shell command in this conversation's workspace.",
    "Drag across any text to copy it. `/copy` copies the latest reply.",
    "Keep typing while an agent works: messages queue and run in order.",
    "`/bg fix the flaky test` starts a parallel conversation without leaving this one.",
    "`Ctrl+N` and `Ctrl+P` step through open conversations.",
    "`Ctrl+C` clears the input, then stops running `!` commands, then leaves.",
    "Type `@` to mention a file; matching is fuzzy and `Tab` inserts it.",
    "`Ctrl+R` searches everything you have typed, across sessions.",
    "Press `Esc` twice to stop the agent. `Esc` alone clears the draft; `Ctrl+Y` restores it.",
    "End a line with `\\` or press `Shift+Enter` for a new line.",
    "`jackalope -p \"message\"` runs once and prints the reply, for scripts and CI.",
    "`Ctrl+Z` suspends to your shell; `fg` brings Jackalope back.",
    "Start a line with a space to keep it out of your history.",
];

pub fn draw(frame: &mut Frame, app: &App) {
    let full = frame.area();
    app.hits.borrow_mut().clear();
    // With room, the interface follows the desktop app: a darker shell holds
    // a header line, one rounded content card and a status line. Smaller
    // terminals keep a compact header and status line on a plain ground.
    let framed = full.width >= 60 && full.height >= 16;
    frame.render_widget(
        Block::default().style(brand::painted_style(if framed {
            Surface::Shell
        } else {
            Surface::Ground
        })),
        full,
    );
    let area = if framed {
        let [top, middle, bottom] = Layout::vertical([
            Constraint::Length(1),
            Constraint::Min(1),
            Constraint::Length(1),
        ])
        .areas(full);
        chrome::header(frame, app, top);
        chrome::status(frame, app, bottom);
        let card = Rect {
            x: middle.x + 1,
            width: middle.width.saturating_sub(2),
            ..middle
        };
        let block = Block::default()
            .borders(Borders::ALL)
            .border_type(brand::border())
            .border_style(Style::default().fg(brand::hairline()))
            .style(brand::painted_style(Surface::Ground))
            .padding(Padding::horizontal(1));
        let inner = block.inner(card);
        frame.render_widget(block, card);
        chrome::band(frame, app, card);
        inner
    } else {
        full
    };

    let header: Vec<Line> = if framed {
        Vec::new()
    } else if area.height >= 22 && app.view.is_some() {
        brand::header(header_info(app), false, app.tick)
    } else {
        vec![brand::compact()]
    };
    let show_tip = !framed && area.height >= 18;
    let tip_height = if show_tip { 1 } else { 0 };
    let status_height = if framed { 0 } else { 1 };
    let header_height = if framed { 0 } else { header.len() as u16 + 1 };

    // The draft grows with what is typed, up to a third of the screen, then
    // scrolls to keep the cursor in view.
    let input_width = area.width.saturating_sub(INPUT_LEFT + INPUT_RIGHT).max(2);
    app.input_width.set(input_width);
    // A leading `/`, `!` or `@` becomes the input's mode: the prompt shows it
    // and the text hides it, so deleting it returns to a plain message.
    let draft = app.editor.text();
    let hidden = usize::from(draft.starts_with(['/', '!', '@']));
    let layout = InputLayout::new(&draft[hidden..], input_width);
    let most_rows = (area.height / 3).max(3) as usize;
    let visible_rows = layout.rows.len().clamp(1, most_rows);
    let input_rows = visible_rows as u16 + 2;

    let mut card = if app.picker.is_none() && area.height >= 16 {
        panel::question_card(app, area.width)
    } else {
        Vec::new()
    };
    if card.is_empty() {
        card = needs_you(app, area.width);
    }

    let [header_area, body, status_area, card_area, input_area, tip_area] = Layout::vertical([
        Constraint::Length(header_height),
        Constraint::Min(3),
        Constraint::Length(status_height),
        Constraint::Length(card.len() as u16),
        Constraint::Length(input_rows),
        Constraint::Length(tip_height),
    ])
    .areas(area);
    let (body, panel_area) = panel::split(app, body);
    app.body_area.set(body);

    if !framed {
        let mut header_lines = header;
        header_lines.push(if app.working() {
            brand::divider_active(header_area.width, app.tick)
        } else {
            brand::divider(header_area.width)
        });
        frame.render_widget(Paragraph::new(header_lines), header_area);
    }

    let (lines, offset, bottom) = transcript::visible(app, body.width, body.height);
    app.max_scroll.set(bottom);
    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .scroll((offset.min(u16::MAX as usize) as u16, 0)),
        body,
    );

    if let Some(panel_area) = panel_area {
        if app.plan_shown() {
            plan::draw(frame, app, panel_area);
        } else {
            panel::changes(frame, app, panel_area);
        }
    }
    if !framed {
        frame.render_widget(Paragraph::new(status(app)), status_area);
    }
    frame.render_widget(Paragraph::new(card), card_area);

    // The bar and prompt say what Enter will do: a shell command, a slash
    // command, or a message for the agent.
    let text = app.editor.text();
    let mentioning = !app.mention_matches().is_empty();
    let (mode_color, prompt, mode_hint) = if text.starts_with('!') {
        (
            brand::warning(),
            "!",
            "shell · runs here, not sent to an agent",
        )
    } else if text.starts_with("/plan ") || text.starts_with("/revise ") {
        (
            brand::success(),
            "/",
            "plan · explores read-only, asks, then drafts a plan to approve",
        )
    } else if text.starts_with('/') {
        (brand::accent(), "/", "command")
    } else if text.starts_with('@') || mentioning {
        (brand::info(), "@", "mention an agent or file")
    } else if app.working() && !text.is_empty() {
        (brand::accent(), "❯", "queues after the current work")
    } else {
        (brand::accent(), "❯", "")
    };
    let mut block = Block::default()
        .borders(Borders::ALL)
        .border_type(brand::border())
        .border_style(Style::default().fg(mode_color))
        .style(brand::painted_style(Surface::Elevated))
        .padding(Padding::left(INPUT_LEFT));
    if !mode_hint.is_empty() {
        block = block.title(
            Line::styled(
                format!(" {mode_hint} "),
                Style::default().fg(brand::muted()),
            )
            .right_aligned(),
        );
    }
    let inner = block.inner(input_area);
    let cursor = app.editor.cursor().saturating_sub(hidden);
    let (cursor_row, cursor_column) = layout.positions[cursor.min(layout.positions.len() - 1)];
    let first_row = cursor_row.saturating_sub(visible_rows - 1);
    let shown = if text.len() <= hidden {
        Text::styled(
            if hidden == 1 {
                match prompt {
                    "/" => "Type a command · Backspace to leave",
                    "!" => "Type a shell command · Backspace to leave",
                    _ => "Name an agent or file · Backspace to leave",
                }
            } else if app.question().is_some() {
                "Type your answer"
            } else if app.working() {
                "Queue a follow-up"
            } else if app.session.is_some() {
                "Reply"
            } else {
                "What should we work on?"
            },
            Style::default().fg(brand::muted()),
        )
    } else {
        Text::from(
            layout
                .rows
                .iter()
                .skip(first_row)
                .take(visible_rows)
                .map(|row| Line::raw(row.clone()))
                .collect::<Vec<_>>(),
        )
    };
    frame.render_widget(Paragraph::new(shown).block(block), input_area);
    frame.buffer_mut().set_string(
        input_area.x + 2,
        inner.y,
        if prompt == "❯" && !brand::unicode() {
            ">"
        } else {
            prompt
        },
        Style::default().fg(mode_color).add_modifier(Modifier::BOLD),
    );

    if show_tip {
        draw_tip(frame, app, tip_area);
    }

    if let Some(selection) = &app.selection {
        let buffer = frame.buffer_mut();
        let area = buffer.area;
        for row in area.top()..area.bottom() {
            for column in area.left()..area.right() {
                if selection.contains(column, row) {
                    if let Some(cell) = buffer.cell_mut((column, row)) {
                        cell.modifier.insert(Modifier::REVERSED);
                    }
                }
            }
        }
    }

    if let Some(picker) = &app.picker {
        menus::picker(frame, picker, area);
        return;
    }
    let matches = slash_matches(text);
    if !matches.is_empty() {
        menus::slash_menu(frame, &matches, app.slash, input_area);
    } else {
        let mentions = app.mention_matches();
        if !mentions.is_empty() {
            menus::mention_menu(frame, &mentions, app.slash, input_area);
        }
    }
    frame.set_cursor_position((
        inner.x + (cursor_column as u16).min(inner.width.saturating_sub(1)),
        inner.y + ((cursor_row - first_row) as u16).min(inner.height.saturating_sub(1)),
    ));
}

/// What the open conversation is waiting on, pinned above the input in
/// amber so it reads at a glance: the reason, and how to carry on.
fn needs_you(app: &App, width: u16) -> Vec<Line<'static>> {
    if let Some(deviation) = app.pending_deviation() {
        return deviation_banner(&deviation.summary, &deviation.amendment, width);
    }
    let Some(error) = app
        .view
        .as_ref()
        .and_then(|view| protocol::present(view.error.as_deref()))
    else {
        return Vec::new();
    };
    let warning = brand::warning();
    let mut lines = transcript::callout(
        vec![
            vec![
                Span::styled(
                    "Needs you  ",
                    Style::default().fg(warning).add_modifier(Modifier::BOLD),
                ),
                Span::styled(error.to_string(), Style::default().fg(brand::text())),
            ],
            vec![Span::styled(
                "/retry to run it again, or reply with what to change",
                Style::default().fg(brand::muted()),
            )],
        ],
        warning,
        width,
    );
    lines.push(Line::raw(""));
    lines
}

/// A plan paused by a deviation: what departed from the plan and the three
/// ways to carry on.
fn deviation_banner(summary: &str, amendment: &str, width: u16) -> Vec<Line<'static>> {
    let warning = brand::warning();
    let muted = Style::default().fg(brand::muted());
    let mut rows = vec![vec![
        Span::styled(
            "Needs you  ",
            Style::default().fg(warning).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("The plan is paused: {summary}"),
            Style::default().fg(brand::text()),
        ),
    ]];
    if !amendment.is_empty() {
        rows.push(vec![Span::styled(
            format!("Proposed amendment: {amendment}"),
            muted,
        )]);
    }
    rows.push(vec![Span::styled(
        "Enter or /deviation to choose · accept and amend · redo · re-plan",
        muted,
    )]);
    let mut lines = transcript::callout(rows, warning, width);
    lines.push(Line::raw(""));
    lines
}

/// Columns inside the input's border kept for the prompt and a gap, and the
/// border columns themselves.
const INPUT_LEFT: u16 = 3;
const INPUT_RIGHT: u16 = 2;

fn draw_tip(frame: &mut Frame, app: &App, area: Rect) {
    if area.height == 0 || area.width < 10 {
        return;
    }
    let accent = Style::default().fg(brand::accent());
    let tip = TIPS[app.tip_index % TIPS.len()];
    let mut spans = vec![Span::styled("  Tip: ", accent.add_modifier(Modifier::BOLD))];
    spans.extend(inline(tip));
    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}

pub fn duration(elapsed: Duration) -> String {
    let seconds = elapsed.as_secs();
    if seconds < 10 {
        format!("{:.1}s", elapsed.as_secs_f32())
    } else if seconds < 60 {
        format!("{seconds}s")
    } else if seconds < 3600 {
        format!("{}m {:02}s", seconds / 60, seconds % 60)
    } else {
        format!("{}h {:02}m", seconds / 3600, seconds % 3600 / 60)
    }
}

/// The work's state as a short label and its colour, with the details that
/// follow it: elapsed time, the step, queued messages, changed files, running
/// commands and any confirmation.
pub(super) fn status_parts(app: &App) -> (String, Color, Vec<Span<'static>>) {
    let muted = Style::default().fg(brand::muted());
    let accent = Style::default().fg(brand::accent());
    let mut parts: Vec<Span> = Vec::new();
    if app.offline.is_some() {
        return (
            "Reconnecting".into(),
            brand::warning(),
            vec![Span::styled(
                "  lost contact with Jackalope, retrying",
                muted,
            )],
        );
    }
    let (label, color) = match &app.view {
        None => {
            if let Some(agent) = &app.next_agent {
                parts.push(Span::styled("  next with ", muted));
                parts.push(Span::styled(app.agent_name(agent), accent));
            }
            ("Ready".to_string(), brand::success())
        }
        Some(view) => {
            let (state, tone) = app.work_state(view);
            if let Some(elapsed) = app.elapsed() {
                parts.push(Span::styled(format!("  {}", duration(elapsed)), muted));
            }
            if let Some(quiet) = app.quiet() {
                parts.push(Span::styled(
                    format!("  no new output for {}", duration(quiet)),
                    Style::default().fg(brand::warning()),
                ));
            }
            if let Some(detail) = view
                .step_detail
                .as_ref()
                .filter(|detail| !detail.is_empty() && app.working())
            {
                let short: String = detail.chars().take(60).collect();
                parts.push(Span::styled(format!("  {short}"), muted));
            }
            let queued = view.messages.iter().filter(|message| !message.sent).count();
            if queued > 0 {
                parts.push(Span::styled(format!("  {queued} queued"), accent));
            }
            if let Some(attempt) = view.attempt.filter(|attempt| *attempt > 1) {
                parts.push(Span::styled(format!("  attempt {attempt}"), muted));
            }
            let files = app.changes.len();
            if files > 0 && !app.panel_shown() {
                parts.push(Span::styled(
                    format!(
                        "  {files} {} changed",
                        if files == 1 { "file" } else { "files" }
                    ),
                    muted,
                ));
            }
            let mut label = state;
            if let Some(first) = label.get_mut(..1) {
                first.make_ascii_uppercase();
            }
            let color = if app.working() {
                brand::accent()
            } else {
                tone.color()
            };
            (label, color)
        }
    };
    let running = app.shells_running();
    if running > 0 {
        parts.push(Span::styled(
            format!(
                "  {running} {} running",
                if running == 1 { "command" } else { "commands" }
            ),
            accent,
        ));
    }
    if app.scroll_top.is_some() {
        parts.push(Span::styled("  scrolled back, Esc to return", muted));
    }
    if let Some((text, tone, _)) = &app.flash {
        parts.push(Span::styled(
            format!("  {text}"),
            Style::default()
                .fg(tone.color())
                .add_modifier(Modifier::BOLD),
        ));
    }
    (label, color, parts)
}

/// The status as one line, for terminals too small for the bars.
fn status(app: &App) -> Line<'static> {
    let (label, color, details) = status_parts(app);
    let style = Style::default().fg(color);
    let mut parts = vec![Span::raw(" ")];
    if app.working() {
        parts.push(Span::styled(
            format!("{} ", brand::spinner(app.tick)),
            style,
        ));
        parts.extend(brand::shimmer(&label, app.tick, style));
    } else {
        parts.push(Span::styled(
            format!("{} {label}", brand::mark_glyph(brand::Mark::Full)),
            style,
        ));
    }
    parts.extend(details);
    Line::from(parts)
}

/// The lines beside the small mark while a conversation is open: where you
/// are, what this conversation is doing, everything else that is open, and
/// which agents can take work.
fn header_info(app: &App) -> Vec<Line<'static>> {
    let muted = Style::default().fg(brand::muted());
    let accent = Style::default().fg(brand::accent());
    let bold = Style::default().add_modifier(Modifier::BOLD);
    let mut lines = Vec::new();

    let mut place = vec![Span::styled(app.project.name.clone(), bold)];
    let branch = app
        .view
        .as_ref()
        .and_then(|view| view.branch.clone())
        .filter(|branch| !branch.is_empty())
        .or_else(|| app.branch.clone());
    if let Some(branch) = branch {
        place.push(Span::styled(
            format!("  {}", brand::short_branch(&branch)),
            accent,
        ));
    }
    lines.push(Line::from(place));

    if let Some(view) = &app.view {
        let title: String = view.title.chars().take(56).collect();
        let mut spans = vec![Span::styled(title, Style::default())];
        if let Some(reason) = view.routing.as_ref().filter(|reason| !reason.is_empty()) {
            let reason: String = reason.chars().take(48).collect();
            spans.push(Span::styled(format!("  {reason}"), muted));
        }
        lines.push(Line::from(spans));
    }

    let others: Vec<&SessionSummary> = app
        .sessions
        .iter()
        .filter(|session| Some(&session.id) != app.session.as_ref())
        .collect();
    let mut activity = vec![Span::styled(
        format!(
            "{} other {}",
            others.len(),
            if others.len() == 1 {
                "conversation"
            } else {
                "conversations"
            }
        ),
        muted,
    )];
    let needs_you: Vec<&str> = others
        .iter()
        .filter(|session| protocol::present(session.error.as_deref()).is_some())
        .map(|session| session.title.as_str())
        .collect();
    if !needs_you.is_empty() {
        let first: String = needs_you[0].chars().take(28).collect();
        let more = if needs_you.len() > 1 {
            format!(" +{}", needs_you.len() - 1)
        } else {
            String::new()
        };
        activity.push(Span::styled(
            format!(
                " · {} needs you: {first}{more}",
                brand::mark_glyph(brand::Mark::Attention)
            ),
            Style::default().fg(brand::warning()),
        ));
    }
    let queued: usize = others.iter().map(|session| session.pending).sum();
    if queued > 0 {
        activity.push(Span::styled(format!(" · {queued} queued"), muted));
    }
    let paused = others.iter().filter(|session| session.paused).count();
    if paused > 0 {
        activity.push(Span::styled(format!(" · {paused} paused"), muted));
    }
    if !others.is_empty() {
        activity.push(Span::styled("  Ctrl+N/P", accent));
    }
    lines.push(Line::from(activity));

    let mut agents = Vec::new();
    match &app.overview {
        None => agents.push(Span::styled("checking agents…", muted)),
        Some(Err(_)) => agents.push(Span::styled("agents unavailable · /agents", muted)),
        Some(Ok(overview)) => {
            for agent in overview.agents.iter().filter(|agent| usable(agent)) {
                let color = match agent.state.as_str() {
                    "ready" => brand::success(),
                    "sign-in" => brand::warning(),
                    _ => brand::muted(),
                };
                agents.push(Span::styled(
                    format!("{} ", agent_glyph(&agent.state)),
                    Style::default().fg(color),
                ));
                agents.push(Span::styled(format!("{}  ", agent.name), muted));
            }
            if agents.is_empty() {
                agents.push(Span::styled("no agents set up · /agents", muted));
            }
        }
    }
    lines.push(Line::from(agents));
    lines
}

/// How far the wordmark's light sweep has crossed (0 to 1), from when the
/// start screen was first drawn; `None` before and after it runs.
pub(super) fn intro_sweep(app: &App) -> Option<f32> {
    const DELAY: f32 = 0.2;
    const SWEEP: f32 = 1.0;
    if app.view.is_some() || app.session.is_some() {
        return None;
    }
    let elapsed = app.intro.get()?.elapsed().as_secs_f32() - DELAY;
    (elapsed < SWEEP).then(|| (elapsed / SWEEP).max(0.0))
}

/// The start screen, centred in `height` rows: the wordmark, then who can
/// take the work as chips. Where you are already sits on the frame, and key
/// hints beneath it.
fn welcome(app: &App, width: u16, height: u16) -> Vec<Line<'static>> {
    let muted = Style::default().fg(brand::muted());
    let mut group: Vec<Line<'static>> = Vec::new();
    if app.intro.get().is_none() {
        app.intro.set(Some(std::time::Instant::now()));
    }
    let sweep = intro_sweep(app);
    if usize::from(width) >= brand::WORDMARK_WIDTH + 4 && height >= 12 {
        group.extend(
            brand::wordmark_sweeping(false, sweep)
                .into_iter()
                .map(Line::centered),
        );
    } else if usize::from(width) >= brand::SMALL_WORDMARK_WIDTH + 2 && height >= 9 {
        group.extend(
            brand::wordmark_sweeping(true, sweep)
                .into_iter()
                .map(Line::centered),
        );
    } else {
        group.push(
            Line::styled(
                "jackalope",
                Style::default()
                    .fg(brand::accent())
                    .add_modifier(Modifier::BOLD),
            )
            .centered(),
        );
    }
    group.push(Line::styled("your coding agents, orchestrated", muted).centered());
    group.push(Line::raw(""));

    match &app.overview {
        None => group.push(Line::styled("checking agents…", muted).centered()),
        Some(Err(error)) => group.push(Line::styled(error.clone(), muted).centered()),
        Some(Ok(overview)) => {
            let mut chips = Vec::new();
            let dot = if brand::unicode() { "●" } else { "*" };
            for agent in overview.agents.iter().filter(|agent| usable(agent)) {
                let ready = agent.state == "ready";
                if !chips.is_empty() {
                    chips.push(Span::raw(" "));
                }
                let color = if agent.id == overview.default_agent {
                    brand::accent()
                } else if ready {
                    brand::success()
                } else {
                    brand::muted()
                };
                chips.push(brand::chip(&format!("{dot} {}", agent.name), color));
            }
            if chips.is_empty() {
                group.push(Line::styled("No agents set up yet  ·  /agents", muted).centered());
            } else {
                group.push(Line::from(chips).centered());
            }
        }
    }

    let here = app.sessions_here();
    if !here.is_empty() {
        let waiting = here
            .iter()
            .filter(|session| protocol::present(session.error.as_deref()).is_some())
            .count();
        let mut spans = vec![Span::styled(format!("{} open here", here.len()), muted)];
        if waiting > 0 {
            spans.push(Span::raw("  "));
            spans.push(brand::chip(
                &format!("{waiting} need you"),
                brand::warning(),
            ));
        }
        spans.push(Span::styled("  /sessions", muted));
        group.push(Line::raw(""));
        group.push(Line::from(spans).centered());
    }

    // Centred, with the space below filled so the bottom-anchored view keeps
    // it in the middle.
    let spare = (height as usize).saturating_sub(group.len());
    let mut lines = vec![Line::raw(""); spare / 2];
    lines.extend(group);
    lines.extend(std::iter::repeat_n(Line::raw(""), spare - spare / 2));
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotating_tips_are_non_empty_and_render_cleanly() {
        assert!(!TIPS.is_empty());
        for tip in TIPS {
            let spans = inline(tip);
            assert!(!spans.is_empty(), "every tip should produce spans");
            let line = Line::from(spans);
            assert!(line.width() > 10, "tip should be substantive: {tip}");
        }
    }

    #[test]
    fn durations_read_briefly() {
        assert_eq!(duration(Duration::from_millis(2500)), "2.5s");
        assert_eq!(duration(Duration::from_secs(42)), "42s");
        assert_eq!(duration(Duration::from_secs(125)), "2m 05s");
        assert_eq!(duration(Duration::from_secs(3720)), "1h 02m");
    }
}
