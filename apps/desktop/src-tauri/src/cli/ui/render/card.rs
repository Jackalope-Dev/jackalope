//! The run card: the latest run framed as one record, with the reply first,
//! then what the host recorded about the work (its stages, steps, check and
//! changed files) and the commands that move it on along the bottom edge.
//!
//! Built every frame, unlike the cached conversation above it, so the running
//! stage can shimmer, the newest step can resolve out of noise as it arrives
//! and a finished result can decode into place once. Every figure comes from
//! the host or the workspace's Git state; nothing is shown that was not
//! recorded.

use super::duration;
use super::transcript::{wrap, LineHit};
use crate::brand;
use crate::protocol::{self, RunStage, RunStatus, RunSummary, SessionView};
use crate::ui::App;
use crate::ui::Click;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use std::time::Duration;

/// How long a finished result takes to decode into place.
const REVEAL: Duration = Duration::from_millis(900);
/// How long a new step takes to resolve.
const STEP_REVEAL: Duration = Duration::from_millis(320);
/// Files listed before the rest are counted.
const FILES_SHOWN: usize = 4;
/// Columns the widest file's change bar takes.
const BAR_WIDTH: usize = 14;
/// Narrower cards drop the frame and fall back to plain rows.
const MIN_WIDTH: u16 = 36;

/// A finished result is still decoding, so frames must keep coming.
pub fn revealing(app: &App) -> bool {
    brand::motion()
        && app.reveal.as_ref().is_some_and(|(_, at)| {
            at.elapsed().as_secs_f32() < REVEAL.as_secs_f32() + super::SETTLE
        })
}

/// What the card is showing.
#[derive(Clone, Copy, PartialEq)]
pub enum Phase {
    /// Work is running; the reply, if any, is still being written.
    Live,
    /// The run ended; its reply sits inside the card.
    Finished,
}

pub fn card(
    app: &App,
    view: &SessionView,
    run: &RunSummary,
    reply: &[Line<'static>],
    phase: Phase,
    width: u16,
) -> (Vec<Line<'static>>, Vec<LineHit>) {
    if width < MIN_WIDTH {
        return (reply.to_vec(), Vec::new());
    }
    let mut hits = Vec::new();
    let room = usize::from(width) - 4;
    let tone = tone(view, run, phase);
    let mut body: Vec<Line<'static>> = Vec::new();

    if !reply.is_empty() {
        for line in reply {
            body.extend(rows(line.clone(), room));
        }
        if phase == Phase::Live {
            let cursor = Span::styled(
                brand::mark_glyph(brand::Mark::Caret),
                Style::default().fg(brand::accent()),
            );
            match body.last_mut() {
                Some(line) => line.spans.push(cursor),
                None => body.push(Line::from(cursor)),
            }
        }
        body.push(Line::raw(""));
        body.push(rule(room));
    }

    if !run.stages.is_empty() {
        body.extend(rail(&run.stages, phase, tone, room, app.tick));
    }
    if phase == Phase::Live {
        body.extend(steps(app, run, room));
    }
    if let Some(tally) = tally(app, run) {
        body.extend(rows(tally, room));
    }
    if let Some(check) = &run.check {
        body.extend(rows(check_line(check), room));
    }
    if !app.panel_shown() {
        // Each file row opens that file in the changes panel. The card's
        // blank line and top edge come before the body.
        let listed = files(app, room);
        for index in 0..app.changes.len().min(FILES_SHOWN) {
            hits.push(LineHit {
                line: 2 + body.len() + 1 + index,
                x: 0,
                width,
                click: Click::File(index),
            });
        }
        body.extend(listed);
    }

    // A result that just arrived decodes into place, top to bottom.
    if phase == Phase::Finished {
        if let Some((run_id, at)) = &app.reveal {
            if view.run_id.as_ref() == Some(run_id) && at.elapsed() < REVEAL {
                let progress = at.elapsed().as_secs_f32() / REVEAL.as_secs_f32();
                let count = body.len().max(1) as f32;
                body = body
                    .into_iter()
                    .enumerate()
                    .map(|(index, line)| {
                        let start = 0.35 * index as f32 / count;
                        let local = ((progress - start) / 0.65).clamp(0.0, 1.0);
                        brand::decode(line, local, app.tick, index)
                    })
                    .collect();
            }
        }
    }

    let mut lines = vec![Line::raw(""), top(app, view, run, phase, tone, width)];
    let edge = Style::default().fg(brand::hairline());
    let side = brand::mark_glyph(brand::Mark::Side);
    for line in body {
        let used = line.width();
        let mut spans = vec![Span::styled(format!("{side} "), edge)];
        spans.extend(line.spans);
        spans.push(Span::raw(" ".repeat(room.saturating_sub(used))));
        spans.push(Span::styled(format!(" {side}"), edge));
        lines.push(Line::from(spans));
    }
    let (edge_line, actions) = bottom(view, phase, width);
    for (x, length, command) in actions {
        hits.push(LineHit {
            line: lines.len(),
            x,
            width: length,
            click: Click::Command(command),
        });
    }
    lines.push(edge_line);
    (lines, hits)
}

/// The card's colour: what the person should take from it at a glance.
fn tone(view: &SessionView, run: &RunSummary, phase: Phase) -> Color {
    if !view.questions.is_empty() {
        brand::warning()
    } else if phase == Phase::Live {
        brand::accent()
    } else if protocol::present(view.error.as_deref()).is_some()
        || run.check.as_ref().is_some_and(|check| !check.passed)
        || view.status == Some(RunStatus::Failed)
    {
        brand::danger()
    } else if view.status.as_ref().is_some_and(RunStatus::is_stopped) {
        brand::muted()
    } else {
        brand::success()
    }
}

/// The run's state in a word or two, for the card's top edge.
fn state(view: &SessionView, run: &RunSummary, phase: Phase) -> &'static str {
    if !view.questions.is_empty() {
        return "needs you";
    }
    if phase == Phase::Live {
        return match view.status {
            Some(RunStatus::Starting) => "starting",
            Some(RunStatus::Stopping) => "stopping",
            _ => "working",
        };
    }
    if view.merged {
        return "merged";
    }
    match view.status {
        Some(RunStatus::Failed) => "failed",
        Some(RunStatus::Stopped) => "stopped",
        Some(RunStatus::Interrupted) => "interrupted",
        _ if run.check.as_ref().is_some_and(|check| !check.passed) => "check failed",
        Some(RunStatus::Reviewed) => "reviewed",
        _ => "ready",
    }
}

/// `╭─ ● ready · Claude Code · opus ─────────── 4m 12s ─╮`
fn top(
    app: &App,
    view: &SessionView,
    run: &RunSummary,
    phase: Phase,
    tone: Color,
    width: u16,
) -> Line<'static> {
    let edge = Style::default().fg(brand::hairline());
    let muted = Style::default().fg(brand::muted());
    let (corner, dash, end) = (
        brand::mark_glyph(brand::Mark::TopOpen),
        brand::mark_glyph(brand::Mark::Edge),
        brand::mark_glyph(brand::Mark::TopClose),
    );
    let glyph = match phase {
        Phase::Live if view.questions.is_empty() => brand::spinner(app.tick),
        _ if !view.questions.is_empty() => brand::mark_glyph(brand::Mark::Question),
        _ if tone == brand::danger() => brand::mark_glyph(brand::Mark::Failed),
        _ => brand::mark_glyph(brand::Mark::Done),
    };
    let mut left = vec![
        Span::styled(corner, edge),
        Span::styled(format!("{glyph} "), Style::default().fg(tone)),
        Span::styled(
            state(view, run, phase).to_uppercase(),
            Style::default().fg(tone).add_modifier(Modifier::BOLD),
        ),
    ];
    let mut who = view
        .agent
        .as_deref()
        .map_or_else(|| "agent".into(), |agent| app.agent_name(agent));
    if let Some(model) = view.model.as_deref().filter(|model| !model.is_empty()) {
        who = format!("{who} · {model}");
    }
    if let Some(attempt) = view.attempt.filter(|attempt| *attempt > 1) {
        who = format!("{who} · attempt {attempt}");
    }
    let elapsed = match phase {
        Phase::Finished => run
            .duration_ms
            .map(|ms| duration(Duration::from_millis(ms))),
        Phase::Live => app
            .work_started
            .as_ref()
            .map(|(_, at)| duration(at.elapsed())),
    };
    let right = elapsed
        .map(|elapsed| format!(" {elapsed}"))
        .unwrap_or_default();
    let fixed: usize = left.iter().map(Span::width).sum::<usize>() + right.chars().count() + 4;
    let room = usize::from(width).saturating_sub(fixed + 3);
    if room >= 8 {
        left.push(Span::styled(
            format!(" · {}", brand::ellipsize(&who, room)),
            muted,
        ));
    }
    let used: usize = left.iter().map(Span::width).sum::<usize>() + right.chars().count();
    let fill = usize::from(width).saturating_sub(used + 4);
    left.push(Span::styled(format!(" {}", dash.repeat(fill)), edge));
    left.push(Span::styled(right, Style::default().fg(brand::text())));
    left.push(Span::styled(end, edge));
    Line::from(left)
}

/// The bottom edge carries what moves the work on.
/// The bottom edge, and where each command on it sits: its column, width and
/// the command it runs.
fn bottom(
    view: &SessionView,
    phase: Phase,
    width: u16,
) -> (Line<'static>, Vec<(u16, u16, &'static str)>) {
    let edge = Style::default().fg(brand::hairline());
    let key = Style::default().fg(brand::command());
    let muted = Style::default().fg(brand::muted());
    let (corner, dash, end) = (
        brand::mark_glyph(brand::Mark::BottomOpen),
        brand::mark_glyph(brand::Mark::Edge),
        brand::mark_glyph(brand::Mark::BottomClose),
    );
    let actions: Vec<(&'static str, &'static str)> = if !view.questions.is_empty() {
        vec![("/answer", "choose"), ("", "or type a reply")]
    } else if phase == Phase::Live {
        vec![("Esc Esc", "stop"), ("", "typing queues a follow-up")]
    } else if view.merged {
        vec![("", "reply to keep going")]
    } else if matches!(
        view.status,
        Some(RunStatus::Failed | RunStatus::Interrupted)
    ) {
        vec![("/retry", ""), ("", "or reply")]
    } else {
        vec![
            ("/review", ""),
            ("/merge", ""),
            ("/pr", ""),
            ("", "or reply"),
        ]
    };
    let mut spans = vec![Span::styled(corner, edge)];
    let mut places = Vec::new();
    for (command, label) in actions {
        spans.push(Span::raw(" "));
        if !command.is_empty() {
            let at: usize = spans.iter().map(Span::width).sum();
            // `Esc Esc` stops the work, as `/stop` does.
            let runs = command.strip_prefix('/').unwrap_or("stop");
            let length = command.chars().count()
                + if label.is_empty() {
                    0
                } else {
                    1 + label.chars().count()
                };
            places.push((at as u16, length as u16, runs));
            spans.push(Span::styled(command.to_string(), key));
            if !label.is_empty() {
                spans.push(Span::raw(" "));
            }
        }
        if !label.is_empty() {
            spans.push(Span::styled(label.to_string(), muted));
        }
        spans.push(Span::raw(" "));
    }
    let used: usize = spans.iter().map(Span::width).sum::<usize>() + 2;
    if used > usize::from(width) {
        let fill = usize::from(width).saturating_sub(4);
        let line = Line::from(vec![
            Span::styled(corner, edge),
            Span::styled(dash.repeat(fill), edge),
            Span::styled(end, edge),
        ]);
        return (line, Vec::new());
    }
    spans.push(Span::styled(
        dash.repeat(usize::from(width).saturating_sub(used)),
        edge,
    ));
    spans.push(Span::styled(end, edge));
    (Line::from(spans), places)
}

/// A dotted divider between the reply and the record of the work.
fn rule(room: usize) -> Line<'static> {
    Line::styled(
        brand::mark_glyph(brand::Mark::Dashed).repeat(room),
        Style::default().fg(brand::hairline()),
    )
}

/// `line` wrapped to the card's inner width.
fn rows(line: Line<'static>, room: usize) -> Vec<Line<'static>> {
    if line.width() <= room {
        return vec![line];
    }
    // Wrapping keeps the space after a row's last word; the edge needs it gone.
    wrap(line.spans, room)
        .into_iter()
        .map(|mut row| {
            if let Some(last) = row.last_mut() {
                let trimmed = last.content.trim_end().to_string();
                last.content = trimmed.into();
            }
            Line::from(row)
        })
        .collect()
}

/// The stages as one gauge, each segment as long as the stage took, with
/// names and times beneath where they fit:
///
/// ```text
/// ━━ ━━━━ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━━
/// route  prepare 4.1s  work 3m 40s            check 8.2s
/// ```
fn rail(
    stages: &[RunStage],
    phase: Phase,
    tone: Color,
    room: usize,
    tick: usize,
) -> Vec<Line<'static>> {
    let bar = brand::mark_glyph(brand::Mark::Gauge);
    let running = |stage: &RunStage| stage.duration_ms.is_none() && phase == Phase::Live;
    let gaps = stages.len().saturating_sub(1);
    let columns = room.saturating_sub(gaps).max(stages.len());
    // The running stage has no length yet; it takes a share that reads as
    // "still going" and the rest follow their recorded times.
    let open = stages.iter().filter(|stage| running(stage)).count();
    let reserved = if open > 0 {
        (columns * 2 / 5).max(6)
    } else {
        0
    };
    let total: u64 = stages
        .iter()
        .filter_map(|stage| stage.duration_ms)
        .sum::<u64>()
        .max(1);
    let finished = stages.iter().filter(|stage| !running(stage)).count();
    let share = columns.saturating_sub(reserved).saturating_sub(finished);
    let mut widths: Vec<usize> = stages
        .iter()
        .map(|stage| {
            if running(stage) {
                reserved / open.max(1)
            } else {
                1 + (share as u64 * stage.duration_ms.unwrap_or(0) / total) as usize
            }
        })
        .collect();
    // Rounding leaves a few columns; the longest stage takes them.
    let used: usize = widths.iter().sum();
    if let Some(longest) = (0..widths.len()).max_by_key(|index| widths[*index]) {
        widths[longest] += columns.saturating_sub(used);
    }

    let mut gauge: Vec<Span<'static>> = Vec::new();
    let mut labels: Vec<Span<'static>> = Vec::new();
    let mut label_end = 0;
    let mut start = 0;
    for (index, (stage, width)) in stages.iter().zip(&widths).enumerate() {
        if index > 0 {
            gauge.push(Span::raw(" "));
            start += 1;
        }
        let position = start as f32 / room.max(1) as f32;
        let color = if running(stage) {
            tone
        } else {
            brand::gradient(position)
        };
        let segment = bar.repeat(*width);
        if running(stage) {
            let head = width.saturating_sub(1);
            gauge.extend(brand::shimmer(
                &bar.repeat(head),
                tick,
                Style::default().fg(color),
            ));
            gauge.push(Span::styled(
                brand::spinner(tick).to_string(),
                Style::default().fg(color),
            ));
        } else {
            gauge.push(Span::styled(segment, Style::default().fg(color)));
        }

        let mut label = stage.name.clone();
        if let Some(ms) = stage.duration_ms {
            label = format!("{label} {}", duration(Duration::from_millis(ms)));
        }
        let length = label.chars().count();
        let mut at = start.max(if label_end == 0 { 0 } else { label_end + 2 });
        // A short stage near the end keeps its label by ending it at the edge.
        if at + length > room && room >= length && room - length >= label_end + 2 {
            at = room - length;
        }
        if at + length <= room {
            labels.push(Span::raw(" ".repeat(at - label_end)));
            let name_style = if running(stage) {
                Style::default().fg(brand::text())
            } else {
                Style::default().fg(brand::muted())
            };
            labels.push(Span::styled(label, name_style));
            label_end = at + length;
        }
        start += width;
    }
    vec![Line::from(gauge), Line::from(labels)]
}

fn step_glyph(kind: &str) -> &'static str {
    brand::mark_glyph(match kind {
        "read" => brand::Mark::Read,
        "edit" => brand::Mark::Edit,
        "search" => brand::Mark::Search,
        "command" => brand::Mark::Command,
        "check" => brand::Mark::Check,
        "failure" => brand::Mark::Failed,
        _ => brand::Mark::Step,
    })
}

fn step_color(kind: &str) -> Color {
    match kind {
        "failure" => brand::danger(),
        "edit" => brand::accent(),
        "check" => brand::success(),
        "command" => brand::command(),
        _ => brand::muted(),
    }
}

/// The newest steps, older ones quiet and the newest resolving out of noise
/// as it arrives.
fn steps(app: &App, run: &RunSummary, room: usize) -> Vec<Line<'static>> {
    let Some((newest, earlier)) = run.steps.split_last() else {
        return Vec::new();
    };
    let muted = Style::default().fg(brand::muted());
    let mut lines = vec![Line::raw("")];
    for step in earlier {
        lines.push(Line::from(vec![
            Span::styled(format!("{} ", step_glyph(&step.kind)), muted),
            Span::styled(brand::ellipsize(&step.text, room.saturating_sub(2)), muted),
        ]));
    }
    let mut seen = app.newest_step.borrow_mut();
    if seen.as_ref().is_none_or(|(text, _)| *text != newest.text) {
        *seen = Some((newest.text.clone(), std::time::Instant::now()));
    }
    let since = seen.as_ref().map_or(STEP_REVEAL, |(_, at)| at.elapsed());
    let line = Line::from(vec![
        Span::styled(
            format!("{} ", step_glyph(&newest.kind)),
            Style::default().fg(step_color(&newest.kind)),
        ),
        Span::styled(
            brand::ellipsize(&newest.text, room.saturating_sub(2)),
            Style::default().fg(brand::text()),
        ),
    ]);
    lines.push(brand::decode(
        line,
        since.as_secs_f32() / STEP_REVEAL.as_secs_f32(),
        app.tick,
        newest.text.len(),
    ));
    lines.push(Line::raw(""));
    lines
}

/// `◇ 14 reads   ⌕ 3 searches   ▸ 2 commands   ✎ 3 files +48 −19`
/// Nothing when no step has been counted yet, rather than a line saying so.
fn tally(app: &App, run: &RunSummary) -> Option<Line<'static>> {
    let muted = Style::default().fg(brand::muted());
    let text = Style::default().fg(brand::text());
    let more = if run.trimmed { "+" } else { "" };
    let mut spans: Vec<Span<'static>> = Vec::new();
    let mut item = |glyph: &str, color: Color, count: String, label: &str| {
        if !spans.is_empty() {
            spans.push(Span::raw("   "));
        }
        spans.push(Span::styled(
            format!("{glyph} "),
            Style::default().fg(color),
        ));
        spans.push(Span::styled(count, text));
        spans.push(Span::styled(format!(" {label}"), muted));
    };
    let plural = |count: usize, one: &'static str, many: &'static str| {
        if count == 1 {
            one
        } else {
            many
        }
    };
    if run.reads > 0 {
        let label = plural(run.reads, "read", "reads");
        item(
            step_glyph("read"),
            brand::muted(),
            format!("{}{more}", run.reads),
            label,
        );
    }
    if run.searches > 0 {
        let label = plural(run.searches, "search", "searches");
        item(
            step_glyph("search"),
            brand::muted(),
            format!("{}{more}", run.searches),
            label,
        );
    }
    if run.commands > 0 {
        let label = plural(run.commands, "command", "commands");
        item(
            step_glyph("command"),
            brand::command(),
            format!("{}{more}", run.commands),
            label,
        );
    }
    if run.failures > 0 {
        let label = plural(run.failures, "failed", "failed");
        item(
            step_glyph("failure"),
            brand::danger(),
            format!("{}", run.failures),
            label,
        );
    }
    let changed = app.changes.len();
    if changed > 0 {
        let label = plural(changed, "file", "files");
        item(
            step_glyph("edit"),
            brand::accent(),
            changed.to_string(),
            label,
        );
        let added: usize = app.changes.iter().filter_map(|change| change.added).sum();
        let removed: usize = app.changes.iter().filter_map(|change| change.removed).sum();
        spans.push(Span::styled(
            format!(" +{added}"),
            Style::default().fg(brand::success()),
        ));
        spans.push(Span::styled(
            format!(" {}{removed}", brand::mark_glyph(brand::Mark::Minus)),
            Style::default().fg(brand::danger()),
        ));
    }
    (!spans.is_empty()).then(|| Line::from(spans))
}

/// `✓ pnpm test passed in 8.2s`
fn check_line(check: &protocol::RunCheck) -> Line<'static> {
    let (glyph, color, verdict) = if check.passed {
        (
            brand::mark_glyph(brand::Mark::Done),
            brand::success(),
            "passed",
        )
    } else {
        (
            brand::mark_glyph(brand::Mark::Failed),
            brand::danger(),
            "failed",
        )
    };
    Line::from(vec![
        Span::styled(format!("{glyph} "), Style::default().fg(color)),
        Span::styled(check.command.clone(), Style::default().fg(brand::text())),
        Span::styled(
            format!(
                " {verdict} in {}",
                duration(Duration::from_millis(check.duration_ms))
            ),
            Style::default().fg(color),
        ),
    ])
}

/// The changed files with a bar each, added lines then removed, scaled to
/// the file that changed most.
fn files(app: &App, room: usize) -> Vec<Line<'static>> {
    if app.changes.is_empty() {
        return Vec::new();
    }
    let size =
        |change: &crate::git::FileChange| change.added.unwrap_or(0) + change.removed.unwrap_or(0);
    let largest = app.changes.iter().map(size).max().unwrap_or(0).max(1);
    let counts_width = 12;
    let bar_width = BAR_WIDTH.min(room / 4);
    let path_width = room.saturating_sub(counts_width + bar_width + 4).max(8);
    let bar = brand::mark_glyph(brand::Mark::Cell);
    let mut lines = vec![Line::raw("")];
    for change in app.changes.iter().take(FILES_SHOWN) {
        let added = change.added.unwrap_or(0);
        let removed = change.removed.unwrap_or(0);
        let length = (bar_width * size(change)).div_ceil(largest).min(bar_width);
        let green = if size(change) == 0 {
            0
        } else {
            (length * added).div_ceil(size(change)).min(length)
        };
        let glyph = match change.status {
            'A' | '?' => "+",
            'D' => brand::mark_glyph(brand::Mark::Minus),
            'R' => brand::mark_glyph(brand::Mark::Renamed),
            _ => step_glyph("edit"),
        };
        let path = fit(&change.path, path_width);
        let counts = match (change.added, change.removed) {
            (None, None) => "binary".to_string(),
            _ => format!(
                "+{added} {}{removed}",
                brand::mark_glyph(brand::Mark::Minus)
            ),
        };
        lines.push(Line::from(vec![
            Span::styled(format!("{glyph} "), Style::default().fg(brand::accent())),
            Span::styled(
                format!("{path:<path_width$}"),
                Style::default().fg(brand::text()),
            ),
            Span::styled(
                format!(" {counts:>counts_width$} "),
                Style::default().fg(brand::muted()),
            ),
            Span::styled(bar.repeat(green), Style::default().fg(brand::success())),
            Span::styled(
                bar.repeat(length - green),
                Style::default().fg(brand::danger()),
            ),
        ]));
    }
    let rest = app.changes.len().saturating_sub(FILES_SHOWN);
    if rest > 0 {
        lines.push(Line::styled(
            format!("  and {rest} more · Ctrl+O"),
            Style::default().fg(brand::muted()),
        ));
    }
    lines
}

/// A path shortened from the left so its file name stays readable.
fn fit(path: &str, width: usize) -> String {
    let count = path.chars().count();
    if count <= width {
        return path.to_string();
    }
    let keep = width.saturating_sub(1);
    let tail: String = path.chars().skip(count - keep).collect();
    format!("…{tail}")
}
