//! Drawing a frame: header, transcript, status line, input, tips and popups.

mod markdown;
mod menus;
pub mod transcript;

use super::commands::slash_matches;
use super::editor::Layout as InputLayout;
use super::feed::Tone;
use super::pickers::{agent_glyph, agent_state_label, usable};
use super::App;
use crate::brand;
use crate::protocol::{self, SessionSummary};
use markdown::inline;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use ratatui::Frame;
use std::time::Duration;

pub const TIPS: &[&str] = &[
    "Run `/learn` to extract session history into reusable project context.",
    "Type `/` to search all commands with arrow navigation and tab completion.",
    "Run `/diff` to inspect changed files and review patches in the desktop app.",
    "Use `/agent` to choose which AI coding agent handles your next conversation.",
    "Switch between active conversations in this repository with `/sessions`.",
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
    let area = frame.area();
    // The full banner greets you; once a conversation is under way the small
    // mark keeps its place beside live context, and a short terminal keeps
    // one line so the conversation has room.
    let header: Vec<Line> = if app.view.is_none() && area.height >= 28 {
        brand::banner()
    } else if area.height >= 22 {
        brand::header(header_info(app), app.working(), app.tick)
    } else {
        vec![brand::compact()]
    };
    let show_tip = area.height >= 18;
    let tip_height = if show_tip { 1 } else { 0 };

    // The draft grows with what is typed, up to a third of the screen, then
    // scrolls to keep the cursor in view.
    let input_width = area.width.saturating_sub(2).max(2);
    app.input_width.set(input_width);
    let layout = InputLayout::new(app.editor.text(), input_width);
    let most_rows = (area.height / 3).max(3) as usize;
    let visible_rows = layout.rows.len().clamp(1, most_rows);
    let input_rows = visible_rows as u16 + 2;

    let [header_area, body, status_area, input_area, tip_area] = Layout::vertical([
        Constraint::Length(header.len() as u16 + 1),
        Constraint::Min(3),
        Constraint::Length(1),
        Constraint::Length(input_rows),
        Constraint::Length(tip_height),
    ])
    .areas(area);
    app.body_area.set(body);

    let mut header_lines = header;
    header_lines.push(brand::divider(header_area.width));
    frame.render_widget(Paragraph::new(header_lines), header_area);

    let (lines, offset, bottom) = transcript::visible(app, body.width, body.height);
    app.max_scroll.set(bottom);
    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .scroll((offset.min(u16::MAX as usize) as u16, 0)),
        body,
    );

    frame.render_widget(Paragraph::new(status(app)), status_area);

    // The border says what Enter will do: a shell command, a slash command,
    // or a message for the agent.
    let text = app.editor.text();
    let (mode_color, mode_title) = if text.starts_with('!') {
        (
            brand::warning(),
            " shell · runs here, not sent to an agent ",
        )
    } else if text.starts_with('/') {
        (brand::accent(), " command ")
    } else if app.working() && !text.is_empty() {
        (brand::accent(), " queues after the current work ")
    } else {
        (brand::accent(), "")
    };
    let mut block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(mode_color));
    if !mode_title.is_empty() {
        block = block.title(Span::styled(mode_title, Style::default().fg(mode_color)));
    }
    let inner = block.inner(input_area);
    let (cursor_row, cursor_column) = layout.positions[app.editor.cursor().min(app.editor.len())];
    let first_row = cursor_row.saturating_sub(visible_rows - 1);
    let shown = if text.is_empty() {
        Text::styled(
            if app.question().is_some() {
                "Type your answer · / commands · ! shell"
            } else if app.working() {
                "Queue a follow-up · / commands · ! shell"
            } else if app.session.is_some() {
                "Reply · / commands · ! shell"
            } else {
                "What should we work on?  / commands · ! shell"
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

fn status(app: &App) -> Line<'static> {
    let muted = Style::default().fg(brand::muted());
    let accent = Style::default().fg(brand::accent());
    let mut parts: Vec<Span> = vec![Span::raw(" ")];
    if app.offline.is_some() {
        let warning = Style::default().fg(brand::warning());
        parts.push(Span::styled(
            format!(
                "{} lost contact with Jackalope · retrying",
                brand::mark_glyph(brand::Mark::Attention)
            ),
            warning.add_modifier(Modifier::BOLD),
        ));
        return Line::from(parts);
    }
    match &app.view {
        None => {
            parts.push(Span::styled(app.project.name.clone(), muted));
            if let Some(branch) = &app.branch {
                parts.push(Span::styled(format!(" · {branch}"), muted));
            }
            parts.push(Span::styled(" · new conversation", muted));
            if let Some(agent) = &app.next_agent {
                parts.push(Span::styled(
                    format!(" · {}", app.agent_name(agent)),
                    accent,
                ));
            }
        }
        Some(view) => {
            let (state, tone) = app.work_state(view);
            if app.working() {
                parts.push(Span::styled(
                    format!("{} ", brand::spinner(app.tick)),
                    accent,
                ));
                parts.extend(brand::shimmer(&state, app.tick, accent));
            } else {
                let glyph = brand::mark_glyph(match tone {
                    Tone::Danger | Tone::Warning => brand::Mark::Attention,
                    _ => brand::Mark::Full,
                });
                let style = Style::default().fg(tone.color());
                parts.push(Span::styled(format!("{glyph} "), style));
                parts.push(Span::styled(state, style));
            }
            if let Some(elapsed) = app.elapsed() {
                parts.push(Span::styled(format!(" {}", duration(elapsed)), muted));
            }
            if let Some(agent) = &view.agent {
                parts.push(Span::styled(" · ", muted));
                let model = view
                    .model
                    .as_deref()
                    .map(|model| format!(" {model}"))
                    .unwrap_or_default();
                parts.push(Span::raw(format!("{agent}{model}")));
            }
            if let Some(detail) = view
                .step_detail
                .as_ref()
                .filter(|detail| !detail.is_empty() && app.working())
            {
                let short: String = detail.chars().take(60).collect();
                parts.push(Span::styled(format!(" · {short}"), muted));
            }
            let queued = view.messages.iter().filter(|message| !message.sent).count();
            if queued > 0 {
                parts.push(Span::styled(format!(" · {queued} queued"), accent));
            }
            if let Some(attempt) = view.attempt.filter(|attempt| *attempt > 1) {
                parts.push(Span::styled(format!(" · attempt {attempt}"), muted));
            }
        }
    }
    let running = app.shells_running();
    if running > 0 {
        parts.push(Span::styled(
            format!(
                " · {running} {} running",
                if running == 1 { "command" } else { "commands" }
            ),
            accent,
        ));
    }
    if app.scroll_top.is_some() {
        parts.push(Span::styled(" · scrolled back, Esc to return", muted));
    }
    if let Some((text, tone, _)) = &app.flash {
        parts.push(Span::styled("  ", muted));
        parts.push(Span::styled(
            text.clone(),
            Style::default()
                .fg(tone.color())
                .add_modifier(Modifier::BOLD),
        ));
    }
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

    let mut place = vec![
        Span::styled("jackalope", accent.add_modifier(Modifier::BOLD)),
        Span::styled("  ", muted),
        Span::styled(app.project.name.clone(), bold),
    ];
    let branch = app
        .view
        .as_ref()
        .and_then(|view| view.branch.clone())
        .filter(|branch| !branch.is_empty())
        .or_else(|| app.branch.clone());
    if let Some(branch) = branch {
        place.push(Span::styled(format!("  {branch}"), accent));
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

/// The start screen: where you are, what is running, and who can do the work.
fn welcome(app: &App) -> Vec<Line<'static>> {
    let accent = Style::default().fg(brand::accent());
    let muted = Style::default().fg(brand::muted());
    let bold = Style::default().add_modifier(Modifier::BOLD);
    let label = |text: &str| Span::styled(format!("  {text:<10}"), muted);
    let mut lines = vec![Line::raw("")];

    let mut project = vec![
        label("Project"),
        Span::styled(app.project.name.clone(), bold),
    ];
    if let Some(branch) = &app.branch {
        project.push(Span::styled(format!("  {branch}"), accent));
    }
    lines.push(Line::from(project));
    lines.push(Line::from(vec![
        label(""),
        Span::styled(app.project.path.clone(), muted),
    ]));
    lines.push(Line::from(vec![
        label("Jackalope"),
        Span::raw(if app.handshake.windowed {
            "running with the app open"
        } else {
            "running in the background"
        }),
        Span::styled("  /open to show the app", muted),
    ]));

    match &app.overview {
        None => lines.push(Line::from(vec![
            label("Agents"),
            Span::styled("checking sign-in…", muted),
        ])),
        Some(Err(error)) => lines.push(Line::from(vec![
            label("Agents"),
            Span::styled(error.clone(), muted),
        ])),
        Some(Ok(overview)) => {
            let ready: Vec<_> = overview
                .agents
                .iter()
                .filter(|agent| usable(agent))
                .collect();
            if ready.is_empty() {
                lines.push(Line::from(vec![
                    label("Agents"),
                    Span::raw("none installed yet · /agents to set one up"),
                ]));
            }
            for (index, agent) in ready.iter().enumerate() {
                let glyph_style = if agent.state == "sign-in" {
                    muted
                } else {
                    accent
                };
                let mut spans = vec![
                    label(if index == 0 { "Agents" } else { "" }),
                    Span::styled(format!("{} ", agent_glyph(&agent.state)), glyph_style),
                    Span::raw(format!("{:<14}", agent.name)),
                    Span::styled(agent_state_label(agent), muted),
                ];
                if agent.id == overview.default_agent {
                    spans.push(Span::styled("  default", accent));
                }
                lines.push(Line::from(spans));
            }
            let missing: Vec<_> = overview
                .agents
                .iter()
                .filter(|agent| !usable(agent))
                .map(|agent| agent.name.clone())
                .collect();
            if !missing.is_empty() {
                lines.push(Line::from(vec![
                    label(""),
                    Span::styled(format!("Not set up: {}", missing.join(", ")), muted),
                ]));
            }
        }
    }

    let here = app.sessions_here();
    if !here.is_empty() {
        let waiting = here
            .iter()
            .filter(|session| protocol::present(session.error.as_deref()).is_some())
            .count();
        let mut spans = vec![
            label("Open"),
            Span::raw(format!(
                "{} {} here",
                here.len(),
                if here.len() == 1 {
                    "conversation"
                } else {
                    "conversations"
                }
            )),
        ];
        if waiting > 0 {
            spans.push(Span::styled(format!(" · {waiting} need you"), accent));
        }
        spans.push(Span::styled("  /sessions to switch", muted));
        lines.push(Line::from(spans));
    }

    lines.push(Line::raw(""));
    lines.push(Line::styled(
        "  Describe what you want done and Jackalope picks the agent.",
        muted,
    ));
    lines.push(Line::from(vec![
        Span::styled("  ", muted),
        Span::styled("/", accent),
        Span::styled(" commands   ", muted),
        Span::styled("/projects", accent),
        Span::styled(" switch repo   ", muted),
        Span::styled("/settings", accent),
        Span::styled(" preferences   ", muted),
        Span::styled("Ctrl+C", accent),
        Span::styled(" leave", muted),
    ]));
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
